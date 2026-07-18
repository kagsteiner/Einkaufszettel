import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "./auth-service.ts";
import type { AppDatabase } from "./database.ts";
import { inTransaction } from "./database.ts";
import { AppError, invalidInput } from "./errors.ts";
import { addDecimal, type NormalizedQuantity, normalizeQuantity } from "./quantity.ts";
import { cleanRequiredText, normalizeComparableText } from "./text.ts";

const categories = [
  "produce",
  "dairy",
  "bakery",
  "meat",
  "staples",
  "canned",
  "spices",
  "drinks",
  "pet",
  "household",
  "frozen",
  "other",
] as const;
const categorySet = new Set<string>(categories);

type ItemRow = {
  category: string;
  completed_at: string | null;
  created_at: string;
  id: string;
  image_id: string | null;
  list_id: string;
  name: string;
  normalized_name: string;
  note: string | null;
  sort_position: number;
  updated_at: string;
};

type QuantityRow = {
  amount: string;
  id: string;
  item_id: string;
  normalized_unit: string;
  unit: string;
};

export type ShoppingItem = Readonly<{
  category: string;
  completedAt: string | null;
  id: string;
  imageId: string | null;
  name: string;
  note: string | null;
  quantities: ReadonlyArray<Readonly<{ amount: string; id: string; unit: string }>>;
  updatedAt: string;
}>;

export class ShoppingService {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  getState(user: AuthenticatedUser): unknown {
    const lists = this.database
      .prepare(
        `SELECT id, name, image_id, sort_position, updated_at
         FROM shopping_lists WHERE household_id = ? ORDER BY sort_position, created_at`,
      )
      .all(user.householdId) as Array<{
      id: string;
      image_id: string | null;
      name: string;
      sort_position: number;
      updated_at: string;
    }>;
    const itemRows = this.database
      .prepare(
        `SELECT i.* FROM items i JOIN shopping_lists l ON l.id = i.list_id
         WHERE l.household_id = ?`,
      )
      .all(user.householdId) as ItemRow[];
    const quantityRows = this.database
      .prepare(
        `SELECT q.* FROM quantity_parts q
         JOIN items i ON i.id = q.item_id JOIN shopping_lists l ON l.id = i.list_id
         WHERE l.household_id = ? ORDER BY q.sort_position, q.created_at`,
      )
      .all(user.householdId) as QuantityRow[];
    const quantitiesByItem = groupQuantities(quantityRows);
    const categoryIndex = new Map<string, number>(
      categories.map((category, index) => [category, index]),
    );
    const itemsByList = new Map<string, ShoppingItem[]>();
    for (const item of itemRows.sort((left, right) => {
      const completion = Number(Boolean(left.completed_at)) - Number(Boolean(right.completed_at));
      return (
        completion ||
        (categoryIndex.get(left.category) ?? 999) - (categoryIndex.get(right.category) ?? 999) ||
        left.sort_position - right.sort_position ||
        left.created_at.localeCompare(right.created_at)
      );
    })) {
      const items = itemsByList.get(item.list_id) || [];
      items.push(toItem(item, quantitiesByItem.get(item.id) || []));
      itemsByList.set(item.list_id, items);
    }

    const pantry = this.database
      .prepare("SELECT id, name FROM pantry_items WHERE household_id = ? ORDER BY normalized_name")
      .all(user.householdId);
    const members = this.database
      .prepare(
        `SELECT u.id, u.display_name AS displayName
         FROM users u JOIN household_members hm ON hm.user_id = u.id
         WHERE hm.household_id = ? ORDER BY u.display_name`,
      )
      .all(user.householdId);

    return {
      household: { id: user.householdId, name: user.householdName, members },
      lists: lists.map((list) => ({
        id: list.id,
        imageId: list.image_id,
        items: itemsByList.get(list.id) || [],
        name: list.name,
        updatedAt: list.updated_at,
      })),
      pantry,
    };
  }

  createList(user: AuthenticatedUser, nameValue: unknown): { id: string; name: string } {
    let name: string;
    try {
      name = cleanRequiredText(nameValue, "Der Zettelname", 80);
    } catch (error) {
      throw invalidInput(error instanceof Error ? error.message : "Der Zettelname ist ungültig.");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      this.database
        .prepare(
          `INSERT INTO shopping_lists
            (id, household_id, name, normalized_name, sort_position,
             created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.householdId,
          name,
          normalizeComparableText(name),
          this.nextListPosition(user.householdId),
          user.id,
          now,
          now,
        );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          409,
          "list_exists",
          "Ein Zettel mit diesem Namen ist bereits vorhanden.",
        );
      }
      throw error;
    }
    return { id, name };
  }

  updateList(
    user: AuthenticatedUser,
    listId: string,
    nameValue: unknown,
  ): { id: string; name: string } {
    this.assertListAccess(user, listId);
    let name: string;
    try {
      name = cleanRequiredText(nameValue, "Der Zettelname", 80);
    } catch (error) {
      throw invalidInput(error instanceof Error ? error.message : "Der Zettelname ist ungültig.");
    }
    try {
      this.database
        .prepare(
          "UPDATE shopping_lists SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
        )
        .run(name, normalizeComparableText(name), new Date().toISOString(), listId);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          409,
          "list_exists",
          "Ein Zettel mit diesem Namen ist bereits vorhanden.",
        );
      }
      throw error;
    }
    return { id: listId, name };
  }

  setListImage(user: AuthenticatedUser, listId: string, imageId: unknown): void {
    this.assertListAccess(user, listId);
    const normalizedImageId = normalizeImageId(imageId);
    this.assertImageAccess(user, normalizedImageId);
    this.database
      .prepare("UPDATE shopping_lists SET image_id = ?, updated_at = ? WHERE id = ?")
      .run(normalizedImageId, new Date().toISOString(), listId);
  }

  addItem(
    user: AuthenticatedUser,
    listId: string,
    input: { category?: unknown; name: unknown; note?: unknown; quantities?: unknown },
  ): { item: ShoppingItem; merge: "created" | "increased" | "appended" | "unchanged" } {
    const name = cleanItemName(input.name);
    const note = cleanNote(input.note);
    const category = normalizeCategory(input.category);
    const quantities = normalizeQuantities(input.quantities);

    return inTransaction(this.database, () => {
      this.assertListAccess(user, listId);
      const existing = this.database
        .prepare("SELECT * FROM items WHERE list_id = ? AND normalized_name = ?")
        .get(listId, normalizeComparableText(name)) as ItemRow | undefined;
      const now = new Date().toISOString();

      if (!existing) {
        const itemId = randomUUID();
        this.database
          .prepare(
            `INSERT INTO items
              (id, list_id, name, normalized_name, note, category, sort_position, created_by_user_id,
               updated_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            itemId,
            listId,
            name,
            normalizeComparableText(name),
            note,
            category,
            this.nextItemPosition(listId),
            user.id,
            user.id,
            now,
            now,
          );
        for (const quantity of quantities) {
          this.insertQuantity(itemId, quantity, now);
        }
        return { item: this.getItem(user, itemId), merge: "created" };
      }

      let increased = false;
      let appended = false;
      for (const quantity of quantities) {
        const stored = this.database
          .prepare(
            "SELECT id, amount FROM quantity_parts WHERE item_id = ? AND normalized_unit = ?",
          )
          .get(existing.id, quantity.normalizedUnit) as { amount: string; id: string } | undefined;
        if (stored) {
          this.database
            .prepare("UPDATE quantity_parts SET amount = ? WHERE id = ?")
            .run(addDecimal(stored.amount, quantity.amount), stored.id);
          increased = true;
        } else {
          this.insertQuantity(existing.id, quantity, now);
          appended = true;
        }
      }
      this.database
        .prepare(
          `UPDATE items SET completed_at = NULL, note = COALESCE(note, ?),
           updated_by_user_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(note, user.id, now, existing.id);
      return {
        item: this.getItem(user, existing.id),
        merge: appended ? "appended" : increased ? "increased" : "unchanged",
      };
    });
  }

  addRecipeItems(
    user: AuthenticatedUser,
    listId: string,
    values: unknown,
  ): Array<{ item: ShoppingItem; merge: "created" | "increased" | "appended" | "unchanged" }> {
    if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
      throw invalidInput("Wähle zwischen einem und 100 Rezeptbestandteilen aus.");
    }
    return inTransaction(this.database, () =>
      values.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw invalidInput("Ein Rezeptbestandteil ist ungültig.");
        }
        const ingredient = value as Record<string, unknown>;
        const amount = ingredient.amount;
        return this.addItem(user, listId, {
          category: ingredient.category,
          name: ingredient.name,
          note: ingredient.note,
          quantities:
            amount === null || amount === undefined || amount === ""
              ? undefined
              : [{ amount, unit: ingredient.unit }],
        });
      }),
    );
  }

  setCompleted(user: AuthenticatedUser, itemId: string, completed: boolean): ShoppingItem {
    const item = this.assertItemAccess(user, itemId);
    const now = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE items SET completed_at = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(completed ? now : null, user.id, now, item.id);
    return this.getItem(user, itemId);
  }

  updateItem(
    user: AuthenticatedUser,
    itemId: string,
    input: { category?: unknown; name?: unknown; note?: unknown; quantities?: unknown },
  ): ShoppingItem {
    return inTransaction(this.database, () => {
      const existing = this.assertItemAccess(user, itemId);
      const name = input.name === undefined ? existing.name : cleanItemName(input.name);
      const note = input.note === undefined ? existing.note : cleanNote(input.note);
      const category =
        input.category === undefined ? existing.category : normalizeCategory(input.category);
      const quantities =
        input.quantities === undefined ? null : normalizeQuantities(input.quantities);
      const now = new Date().toISOString();
      try {
        this.database
          .prepare(
            `UPDATE items SET name = ?, normalized_name = ?, note = ?, category = ?,
             updated_by_user_id = ?, updated_at = ? WHERE id = ?`,
          )
          .run(name, normalizeComparableText(name), note, category, user.id, now, itemId);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AppError(409, "item_exists", "Dieses Produkt steht bereits auf dem Zettel.");
        }
        throw error;
      }
      if (quantities) {
        this.database.prepare("DELETE FROM quantity_parts WHERE item_id = ?").run(itemId);
        for (const quantity of quantities) {
          this.insertQuantity(itemId, quantity, now);
        }
      }
      return this.getItem(user, itemId);
    });
  }

  setItemImage(user: AuthenticatedUser, itemId: string, imageId: unknown): ShoppingItem {
    const item = this.assertItemAccess(user, itemId);
    const normalizedImageId = normalizeImageId(imageId);
    this.assertImageAccess(user, normalizedImageId);
    this.database
      .prepare("UPDATE items SET image_id = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?")
      .run(normalizedImageId, user.id, new Date().toISOString(), item.id);
    return this.getItem(user, itemId);
  }

  deleteItem(user: AuthenticatedUser, itemId: string): void {
    this.assertItemAccess(user, itemId);
    this.database.prepare("DELETE FROM items WHERE id = ?").run(itemId);
  }

  deleteList(user: AuthenticatedUser, listId: string): void {
    this.assertListAccess(user, listId);
    this.database.prepare("DELETE FROM shopping_lists WHERE id = ?").run(listId);
  }

  addPantryItem(user: AuthenticatedUser, nameValue: unknown): { id: string; name: string } {
    const name = cleanItemName(nameValue);
    const id = randomUUID();
    try {
      this.database
        .prepare(
          `INSERT INTO pantry_items
            (id, household_id, name, normalized_name, created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.householdId,
          name,
          normalizeComparableText(name),
          user.id,
          new Date().toISOString(),
        );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(409, "pantry_item_exists", "Dieses Produkt ist bereits im Vorrat.");
      }
      throw error;
    }
    return { id, name };
  }

  deletePantryItem(user: AuthenticatedUser, pantryItemId: string): void {
    const result = this.database
      .prepare("DELETE FROM pantry_items WHERE id = ? AND household_id = ?")
      .run(pantryItemId, user.householdId);
    if (result.changes === 0) {
      throw new AppError(404, "pantry_item_not_found", "Vorratsprodukt nicht gefunden.");
    }
  }

  private assertListAccess(user: AuthenticatedUser, listId: string): void {
    const row = this.database
      .prepare("SELECT 1 FROM shopping_lists WHERE id = ? AND household_id = ?")
      .get(listId, user.householdId);
    if (!row) {
      throw new AppError(404, "list_not_found", "Zettel nicht gefunden.");
    }
  }

  private assertItemAccess(user: AuthenticatedUser, itemId: string): ItemRow {
    const row = this.database
      .prepare(
        `SELECT i.* FROM items i JOIN shopping_lists l ON l.id = i.list_id
         WHERE i.id = ? AND l.household_id = ?`,
      )
      .get(itemId, user.householdId) as ItemRow | undefined;
    if (!row) {
      throw new AppError(404, "item_not_found", "Produkt nicht gefunden.");
    }
    return row;
  }

  private assertImageAccess(user: AuthenticatedUser, imageId: string | null): void {
    if (imageId === null) {
      return;
    }
    const row = this.database
      .prepare("SELECT 1 FROM images WHERE id = ? AND household_id = ?")
      .get(imageId, user.householdId);
    if (!row) {
      throw new AppError(404, "image_not_found", "Bild nicht gefunden.");
    }
  }

  private getItem(user: AuthenticatedUser, itemId: string): ShoppingItem {
    const item = this.assertItemAccess(user, itemId);
    const quantities = this.database
      .prepare("SELECT * FROM quantity_parts WHERE item_id = ? ORDER BY sort_position, created_at")
      .all(itemId) as QuantityRow[];
    return toItem(item, quantities);
  }

  private insertQuantity(itemId: string, quantity: NormalizedQuantity, now: string): void {
    this.database
      .prepare(
        `INSERT INTO quantity_parts
          (id, item_id, amount, unit, normalized_unit, sort_position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        itemId,
        quantity.amount,
        quantity.unit,
        quantity.normalizedUnit,
        this.nextQuantityPosition(itemId),
        now,
      );
  }

  private nextListPosition(householdId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(sort_position), -1) + 1 AS position FROM shopping_lists WHERE household_id = ?",
      )
      .get(householdId) as { position: number };
    return row.position;
  }

  private nextItemPosition(listId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(sort_position), -1) + 1 AS position FROM items WHERE list_id = ?",
      )
      .get(listId) as { position: number };
    return row.position;
  }

  private nextQuantityPosition(itemId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(sort_position), -1) + 1 AS position FROM quantity_parts WHERE item_id = ?",
      )
      .get(itemId) as { position: number };
    return row.position;
  }
}

function normalizeQuantities(value: unknown): NormalizedQuantity[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 10) {
    throw invalidInput("Mengen müssen als Liste mit höchstens zehn Einträgen angegeben werden.");
  }
  const merged = new Map<string, NormalizedQuantity>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw invalidInput("Eine Mengenangabe ist ungültig.");
    }
    const quantity = normalizeQuantity(raw as { amount: unknown; unit?: unknown });
    const existing = merged.get(quantity.normalizedUnit);
    merged.set(
      quantity.normalizedUnit,
      existing ? { ...quantity, amount: addDecimal(existing.amount, quantity.amount) } : quantity,
    );
  }
  return [...merged.values()];
}

function cleanItemName(value: unknown): string {
  try {
    return cleanRequiredText(value, "Der Produktname", 120);
  } catch (error) {
    throw invalidInput(error instanceof Error ? error.message : "Der Produktname ist ungültig.");
  }
}

function cleanNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > 500) {
    throw invalidInput("Der Zusatztext darf höchstens 500 Zeichen lang sein.");
  }
  return value.trim().normalize("NFC") || null;
}

function normalizeCategory(value: unknown): string {
  if (value === undefined) {
    return "other";
  }
  if (typeof value !== "string" || !categorySet.has(value)) {
    throw invalidInput("Der Einkaufsbereich ist ungültig.");
  }
  return value;
}

function groupQuantities(rows: QuantityRow[]): Map<string, QuantityRow[]> {
  const grouped = new Map<string, QuantityRow[]>();
  for (const row of rows) {
    const quantities = grouped.get(row.item_id) || [];
    quantities.push(row);
    grouped.set(row.item_id, quantities);
  }
  return grouped;
}

function toItem(row: ItemRow, quantities: QuantityRow[]): ShoppingItem {
  return {
    category: row.category,
    completedAt: row.completed_at,
    id: row.id,
    imageId: row.image_id,
    name: row.name,
    note: row.note,
    quantities: quantities.map((quantity) => ({
      amount: quantity.amount,
      id: quantity.id,
      unit: quantity.unit,
    })),
    updatedAt: row.updated_at,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function normalizeImageId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw invalidInput("Die Bildreferenz ist ungültig.");
  }
  return value;
}

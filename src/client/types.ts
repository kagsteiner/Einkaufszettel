export type User = Readonly<{
  displayName: string;
  email: string;
  householdId: string;
  householdName: string;
  id: string;
  openAiKeyMask: string | null;
}>;

export type Quantity = Readonly<{ amount: string; id: string; unit: string }>;

export type ShoppingItem = Readonly<{
  category: string;
  completedAt: string | null;
  id: string;
  imageId: string | null;
  name: string;
  note: string | null;
  quantities: ReadonlyArray<Quantity>;
  updatedAt: string;
}>;

export type ShoppingList = Readonly<{
  id: string;
  imageId: string | null;
  items: ReadonlyArray<ShoppingItem>;
  name: string;
  updatedAt: string;
}>;

export type RecurringSuggestion = Readonly<{
  category: string;
  dueAt: string;
  itemId: string;
  lastPurchasedAt: string;
  name: string;
  note: string | null;
  quantities: ReadonlyArray<Quantity>;
}>;

export type AppState = Readonly<{
  household: {
    id: string;
    members: ReadonlyArray<{ displayName: string; id: string }>;
    name: string;
  };
  lists: ReadonlyArray<ShoppingList>;
  pantry: ReadonlyArray<{ id: string; name: string }>;
}>;

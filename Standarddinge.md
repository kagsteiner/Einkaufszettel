## Ziel
Einen Button zum Haupt-UI hinzufügen, der Dinge, die regelmäßig gekauft werden, und "dran" sind, zum Hinzufügen vorschlägt.

## Lösungsvorschlag
Die App merkt sich in der Datenbank für jedes Ding, entweder alle oder die letzten 5 Zeitpunkte, zu denen das Ding abgehakt (also gekauft) wurde. 
Wenn der Kunde in der Ansicht eines Einkaufszettels den Button drückt (mir fällt kein guter kurzer Name ein), zeigt die App ein Modal ähnlich zum Rezept-Modal an. Für jedes Ding wird dann berechnet, was die durchschnittliche Zeit zwischen den Käufen war. Sagen wir, diese Zeit ist t_average. Wenn die Zeit zwischen jetzt und dem letzten Kauf t_last ist, und - in Tagen - t_last +1 >= t_average, dann fügen wir das Ding mit einer Checkbox zur Liste auf dem Modal hinzu. Das "+1" soll bedeuten, das schon, wenn es eigentlich morgen Zeit wäre, aber ich schon heute einkaufen gehe, das Ding bereits vorgeschlagen werden soll.

Die Dinge, die der Benutzer markiert lässt, wenn er den Dialog verlässt (Buttontext und UX bitte wie im Rezeptdialog), werden zur Liste hinzugefügt.

Der Button um den Dialog zu starten sollte idealerweise in der Leiste wie der Rezeptbutton und der Sortierbutton liegen, könnte dann am Handy zu viel für eine Zeile werden. 
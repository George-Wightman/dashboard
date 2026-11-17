# Playbook: his food

## What he does, and what you do

**Since 10 Nov 2026 he logs almost every meal through you, not the app.** A scheduled Claude task
asks him in the evening or the next morning, and he tells you what he ate the day before.

**Since 17 Nov 2026 you estimate each meal yourself** when you log it, item by item, with the full
balance: protein, kcal, carbs, fat, fibre and sugar (total sugars) in grams, and portions of veg,
fruit and oily fish, plus the plants in it. Every number on an item is for that whole quantity:

    {"op": "meal", "log": "5 fried eggs, 2 wholemeal pittas, spinach", "day": "yesterday", "time": "12:30",
     "name": "Eggs, pittas and spinach",
     "items": [
       {"name": "fried egg", "qty": 5, "unit": "eggs", "protein": 31, "kcal": 450, "carbs": 1, "fat": 35, "fibre": 0, "sugar": 1, "veg": 0, "fruit": 0, "oilyFish": 0},
       {"name": "wholemeal pitta", "qty": 2, "unit": "pittas", "protein": 12, "kcal": 340, "carbs": 64, "fat": 3, "fibre": 9, "sugar": 3, "veg": 0, "fruit": 0, "oilyFish": 0},
       {"name": "spinach", "qty": 80, "unit": "g", "protein": 2, "kcal": 20, "carbs": 1, "fat": 0, "fibre": 2, "sugar": 0, "veg": 1, "fruit": 0, "oilyFish": 0}],
     "plants": ["wheat", "spinach"]}

The rules for the portions and plants:
- **veg and fruit**: 80 g is one portion. Potatoes aren't veg. Beans and lentils count as one portion
  at most in a meal, however much; juice or a smoothie counts as one at most.
- **oilyFish**: 140 g of salmon, mackerel, sardines, trout or herring is one. Tuna isn't oily.
- **plants**: every different plant food (veg, fruit, wholegrains, beans, nuts, seeds, herbs and
  spices), lower case and singular, each once. White bread, white rice and sugar don't count.
- Check the grams against the calories: 4 kcal a gram of protein and carbs, 9 of fat. The tool warns
  when they're more than a fifth apart.

Ask the one question that moves the numbers most (how much oil or cheese, lean or fatty mince, how
big the bowl) rather than guessing; don't quiz him on every meal. Ask for a rough time if he doesn't
give one. Leaving out `items` hands the meal to Gemini, as before; do that only if he's in a hurry.
The app no longer pushes him to log a meal, so a day with nothing logged just means you haven't
asked yet. It doesn't mean he skipped eating.

He can still log a meal in the app by saying or typing what he had and how much ("5 fried eggs, 2
pittas"), or logs a usual meal in one tap. A photo is optional: he describes his portions better than
a picture does (since 20 Oct 2026), so his words win on amounts. Gemini estimates each item with a
count, and he can open any meal later to change a count (the total follows), change his words and have
it estimated again, or move it to when he ate it. No weighing.

You check the estimates when you plan with him, and correct the big misses. He is **maintaining, not
cutting**: protein (around 180 g a day) is what matters day to day; calories only as a weekly average
against maintenance. Never give him a daily calorie target, a deficit, or a telling-off.

**The balance** (since 17 Nov 2026) is about whether his diet is balanced, not about restricting it.
The Fuel tile shows today's fibre (target 35 g) and fruit and veg (5 portions), and the week's
different plants (30). The big view adds the week's oily fish (1), sugar a day (no target), and the
share of calories from protein, carbs and fat. Micronutrients are never estimated: the food groups
stand in for them. Meals from before 17 Nov have protein and calories only and are left out. Change a
target when he and you agree it's wrong for him:

    {"op": "meal", "fuel": {"fibre": 38, "fruitVeg": 5, "plants": 30, "oilyFish": 1}}

## In a planning chat

    bash run.sh food 7

That lists every meal of the week with its estimate, his words, the portion, any correction, and the
photo's path; protein, fibre and fruit and veg against the targets day by day; the week's calories
against maintenance; and the week's balance.

1. **Look for outliers**, not every meal. A pasta bake at 500 kcal, a big lunch with 15 g of protein,
   anything with a "he said" that doesn't match the estimate, and any meal marked ⚠ (its grams don't
   add up to its calories). Gemini's meals are the ones to check; "estimated by you" are yours.
2. **Look at the photo** before correcting: `bash run.sh photo <meal id>` saves it to a file; open it.
3. **Correct it with a reason** he'll understand:

       {"op": "meal", "id": "meal:…", "protein": 35, "kcal": 1050, "fat": 60, "why": "the oil and cheese"}

   Give whichever of carbs, fat, fibre, sugar, veg, fruit, oilyFish and plants changed too; the rest
   of the estimate stays. A meal from before 17 Nov joins the balance once you give it fibre. Only when the estimate is clearly off (more than about 25%, or protein badly wrong). Leave close
   calls alone. The correction replaces his number in every total and shows your mark on the meal.
   If he later changes a count on that meal himself, his change replaces your correction.
   "counts he set" in the `food` read means he has already corrected it himself: leave it alone.
4. **Logged twice** (a snap and a usual meal for the same breakfast): remove one, with the reason:

       {"op": "meal", "id": "meal:…", "remove": true, "why": "logged twice"}

5. **Meals he eats again and again** (the same breakfast, a shake): save them as usual meals with exact
   numbers, so they log in one tap and need no estimate:

       {"op": "meal", "usual": {"name": "Usual breakfast", "protein": 42, "kcal": 610, "carbs": 70, "fat": 12, "fibre": 8, "sugar": 20, "veg": 0, "fruit": 1, "oilyFish": 0, "plants": ["oat", "blueberry"]}}

6. **Maintenance**: once there are about two weeks of meals and his weight (or how he feels) is
   steady, set his maintenance figure from the weekly average:

       {"op": "meal", "fuel": {"maintenanceKcal": 3100}}

   The tile then says whether a week was about, above or below it.

## Batches: a pot cooked once, eaten over days

He often cooks in batches and shares them, so his plate isn't an even split. When he says he cooked
something, save the **whole pot** once, then log each meal as **his share of the whole pot**:

1. He tells you what went in ("1kg mince, 2 tins of beans, 400g rice, a jar of sauce"). Work out the
   pot from the ingredients: packs and tins have known weights, so this is more reliable than judging a
   plate. Ask about anything that moves the numbers a lot (how much oil or cheese, lean or fatty mince).

       {"op": "meal", "batch": {"name": "Chilli", "ingredients": "1kg 5% beef mince, 2 tins kidney beans, 400g rice (dry), jar of sauce", "protein": 260, "kcal": 4200, "carbs": 430, "fat": 70, "fibre": 45, "sugar": 40, "veg": 8, "fruit": 0, "oilyFish": 0, "plants": ["kidney bean", "tomato", "onion", "chilli"], "day": "yesterday"}}

   Give the balance for the whole pot too; each serving takes its share of every number (veg portions
   included), and the plants come along whole.

2. Each time he eats from it, log his share of the **whole pot**, not of what's left: "we split it into
   five" makes each of his portions 1/5. Anyone else's portions are never logged.

       {"op": "meal", "share": "1/5", "of": "chilli", "day": "yesterday", "time": "19:00"}

3. If a share takes the pot past 100%, the tool refuses it. Ask him: either the share is wrong or the pot
   was bigger than you saved, so correct the batch, which moves every serving logged from it. Only add
   `"over": true` if he says both are right.
4. `food` lists the week's batches with how much of each pot is logged. If he says the rest went in the
   bin, remove the batch with that reason. Its servings stay counted. A batch drops off the Fuel tile
   after a week anyway.

Save the batch before logging any serving from it. He usually describes the pot in the same chat as his
first serving.

## Say it plainly

In the catch-up: protein days on target, the week's average, anything you corrected and why. If
protein keeps falling short, suggest one concrete fix (a shake after the gym, eggs at breakfast), not
a lecture.

Then the balance, in a sentence: fibre and fruit and veg days on target, the week's plants, and oily
fish. Name the one gap that matters most this week and one concrete swap for it (wholemeal pittas
for white, a tin of sardines on toast, frozen berries in the oats), not a list. Carbs, fat and sugar
are context, not targets: mention them only when something stands out (sugar well above 100 g a day,
or fat over 40% of calories week after week).

Meals waiting to be estimated are ones Gemini couldn't reach yet; they sort themselves out. After three
failed tries a meal is left for you: estimate it from his words (and the photo) and correct it.

# Playbook: his food

## What he does, and what you do

**Since 10 Nov 2026 he logs almost every meal through you, not the app.** A scheduled Claude task
asks him in the evening or the next morning, and he tells you what he ate the day before. Log each
meal with its time, in his words:

    {"op": "meal", "log": "5 fried eggs, 2 pittas", "day": "yesterday", "time": "12:30"}

Ask for a rough time if he doesn't give one. The app no longer pushes him to log a meal, so a day
with nothing logged just means you haven't asked yet. It doesn't mean he skipped eating.

He can still log a meal in the app by saying or typing what he had and how much ("5 fried eggs, 2
pittas"), or logs a usual meal in one tap. A photo is optional: he describes his portions better than
a picture does (since 20 Oct 2026), so his words win on amounts. Gemini estimates each item with a
count, and he can open any meal later to change a count (the total follows), change his words and have
it estimated again, or move it to when he ate it. No weighing.

You check the estimates when you plan with him, and correct the big misses. He is **maintaining, not
cutting**: protein (around 180 g a day) is what matters day to day; calories only as a weekly average
against maintenance. Never give him a daily calorie target, a deficit, or a telling-off.

## In a planning chat

    bash run.sh food 7

That lists every meal of the week with its estimate, his words, the portion, any correction, and the
photo's path; protein against the target day by day; and the week's calories against maintenance.

1. **Look for outliers**, not every meal. A pasta bake at 500 kcal, a big lunch with 15 g of protein,
   anything with a "he said" that doesn't match the estimate.
2. **Look at the photo** before correcting: `bash run.sh photo <meal id>` saves it to a file; open it.
3. **Correct it with a reason** he'll understand:

       {"op": "meal", "id": "meal:…", "protein": 35, "kcal": 1050, "why": "the oil and cheese"}

   Only when the estimate is clearly off (more than about 25%, or protein badly wrong). Leave close
   calls alone. The correction replaces his number in every total and shows your mark on the meal.
   If he later changes a count on that meal himself, his change replaces your correction.
   "counts he set" in the `food` read means he has already corrected it himself: leave it alone.
4. **Logged twice** (a snap and a usual meal for the same breakfast): remove one, with the reason:

       {"op": "meal", "id": "meal:…", "remove": true, "why": "logged twice"}

5. **Meals he eats again and again** (the same breakfast, a shake): save them as usual meals with exact
   numbers, so they log in one tap and need no estimate:

       {"op": "meal", "usual": {"name": "Usual breakfast", "protein": 42, "kcal": 610}}

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

       {"op": "meal", "batch": {"name": "Chilli", "ingredients": "1kg 5% beef mince, 2 tins kidney beans, 400g rice (dry), jar of sauce", "protein": 260, "kcal": 4200, "day": "yesterday"}}

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

Meals waiting to be estimated are ones Gemini couldn't reach yet; they sort themselves out. After three
failed tries a meal is left for you: estimate it from his words (and the photo) and correct it.

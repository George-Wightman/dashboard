# Playbook: his food

## What he does, and what you do

George logs a meal in the app by saying or typing what he had and how much ("5 fried eggs, 2
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

## Say it plainly

In the catch-up: protein days on target, the week's average, anything you corrected and why. If
protein keeps falling short, suggest one concrete fix (a shake after the gym, eggs at breakfast), not
a lecture.

Meals waiting to be estimated are ones Gemini couldn't reach yet; they sort themselves out. After three
failed tries a meal is left for you: estimate it from his words (and the photo) and correct it.

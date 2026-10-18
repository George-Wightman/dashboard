# Playbook: his food

## What he does, and what you do

George snaps a meal in the app (a photo, a line about it, or both) or logs a usual meal in one tap.
Gemini estimates protein and calories straight away, as a range; he picks a portion. That's all he
does: no weighing, no counting.

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
4. **Meals he eats again and again** (the same breakfast, a shake): save them as usual meals with exact
   numbers, so they log in one tap and need no estimate:

       {"op": "meal", "usual": {"name": "Usual breakfast", "protein": 42, "kcal": 610}}

5. **Maintenance**: once there are about two weeks of meals and his weight (or how he feels) is
   steady, set his maintenance figure from the weekly average:

       {"op": "meal", "fuel": {"maintenanceKcal": 3100}}

   The tile then says whether a week was about, above or below it.

## Say it plainly

In the catch-up: protein days on target, the week's average, anything you corrected and why. If
protein keeps falling short, suggest one concrete fix (a shake after the gym, eggs at breakfast), not
a lecture.

Meals waiting to be estimated are ones Gemini couldn't reach yet; they sort themselves out. After three
failed tries a meal is left for you: estimate it from his words (and the photo) and correct it.

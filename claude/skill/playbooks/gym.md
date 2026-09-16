# Playbook: his training

## It is already connected. Check before you doubt it.

    bash run.sh gym

That returns his key lifts with estimated 1RMs, PRs and pace over eight weeks, cardio by week against
the linked target, and the last fortnight's sessions. Workouts come from Hevy through the planner's
script every ten minutes.

If you think there's no gym data, you have not run `gym`. A session once told George a cardio goal was
impossible because "no Hevy connector exists" while `gym` was returning ninety-six workouts.

Only if `gym` itself says Hevy isn't connected is there a problem, and then say so in one line — the
key lives in the planner script's Script properties as `HEVY_KEY`, and only George can set it.

## He plans his own sessions

Never write a session or a routine for him. Never try to reach Hevy; there is no route to it from
here and nothing is ever sent back.

What you do instead is read the trend and put advice where he'll see it:

- the **Gym habit's `notes`** — they lead the Gym block in his calendar, so he has them with him;
- the **brief**, for something that matters today;
- a **task**, when it's a thing to do rather than a thing to know.

## What a workout does on its own

A Hevy workout ticks the Gym habit and moves the Gym block to when he actually trained, and its
cardio minutes count towards the linked weekly target. That is the **only** automatic tick anywhere
in the dashboard. Nothing else ticks itself — a calendar event never does, however it is tagged. If
you find yourself about to tell him something will tick automatically, it won't.

## Setting it up

    {"op": "target", "title": "Cardio", "target": "150m", "unit": "minutes"}
    {"op": "gym", "cardioQuota": "Cardio"}
    {"op": "gym", "liftTargets": {"Squat (Barbell)": 120}}

One lift per op. Names are Hevy's own — "Squat (Barbell)", "Bench Press (Barbell)". `keyLifts` changes
which lifts are followed closely.

## He's training for more cardio while still progressing squat and bench

Hold both when you advise. More cardio that costs him his squat progression is not what he asked for.
When he asks for a chart, draw it in the chat from the `gym` read's numbers.

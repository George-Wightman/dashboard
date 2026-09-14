// Giving an untagged task an area, so it can share a block: one question to Gemini, answered from
// the dashboard's own areas or not at all. Pure; planner/gas.js makes the call.

export function tagPrompt(title, areas) {
  return {
    system: 'You sort to-do items into areas. Answer only with JSON: {"area": "<one of the areas, exactly as written>"}, or {"area": ""} when none fits.',
    prompt: `Areas: ${areas.map((a) => JSON.stringify(a)).join(', ')}\nTo-do: ${JSON.stringify(title)}`,
  };
}

export function readArea(data, areas) {
  const wanted = String(data?.area ?? '').trim().toLowerCase();
  return areas.find((a) => a.toLowerCase() === wanted) ?? '';
}

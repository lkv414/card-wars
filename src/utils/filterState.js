/** Toggle a value in a string[] filter field (immutable). */
export function toggleFilterList(filters, key, value) {
  const list = filters[key]
  return {
    ...filters,
    [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
  }
}

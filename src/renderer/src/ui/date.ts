/** A day's date as the sheets show it: "Monday 31 March, 2026". */
export const dateLabel = (t: number) => {
  const d = new Date(t)
  return `${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')}, ${d.getFullYear()}`
}

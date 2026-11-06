/** No flowers yet: a word on what grows here, on the one panel. */
export function Empty() {
  return (
    <div className="garden-empty panel" data-test="garden-empty" role="status">
      <h2>Nothing planted yet</h2>
      <p>Every flower you grow in the pad is planted here when it blooms.</p>
    </div>
  )
}

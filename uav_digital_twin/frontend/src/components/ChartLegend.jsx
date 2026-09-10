// Legend keys mirror the marks: a stroke for lines, a dot for points, a wash for areas.
export function ChartLegend({ items, vertical = false }) {
  return (
    <ul className={`legend${vertical ? ' legend--vertical' : ''}`}>
      {items.map((item) => (
        <li key={item.label} className="legend__item">
          <span className={`legend__key legend__key--${item.key}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

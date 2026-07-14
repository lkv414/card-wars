export function CardSkeletonGrid({ count = 12 }) {
  return (
    <div className="cards-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card-skeleton" />
      ))}
    </div>
  )
}

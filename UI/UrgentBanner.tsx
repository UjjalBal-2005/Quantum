import type { ProductRecommendation } from '../types/domain';

interface Props { atRisk: ProductRecommendation[]; onShow: () => void }

export default function UrgentBanner({ atRisk, onShow }: Props) {
  if (atRisk.length === 0) return null;
  const names = atRisk.slice(0, 3).map(r => r.product).join(', ');
  const more = atRisk.length > 3 ? ` and ${atRisk.length - 3} more` : '';
  return (
    <div className="banner" role="alert">
      <p>
        <strong>{atRisk.length} product{atRisk.length > 1 ? 's' : ''} may run out before a new order arrives:</strong>{' '}
        {names}{more}.
      </p>
      <button onClick={onShow}>Show urgent items</button>
    </div>
  );
}

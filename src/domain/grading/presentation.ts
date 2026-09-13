export type GradePresentation = {
  label: string;
  finish: 'common' | 'shimmer' | 'bronze' | 'silver' | 'gold' | 'prismatic';
  color: string;
  symbol: 'circle' | 'star';
  count: number;
};
export function gradePresentation(score: number): GradePresentation {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error('Invalid grade score');
  if (score === 100)
    return { label: 'Excellent', finish: 'prismatic', color: '#7359a3', symbol: 'star', count: 3 };
  if (score >= 90)
    return { label: 'Excellent', finish: 'gold', color: '#a77a13', symbol: 'star', count: 3 };
  if (score >= 80)
    return { label: 'Very good', finish: 'silver', color: '#697e8d', symbol: 'star', count: 2 };
  if (score >= 70)
    return { label: 'Good', finish: 'bronze', color: '#895333', symbol: 'star', count: 1 };
  if (score >= 50)
    return { label: 'Mediocre', finish: 'shimmer', color: '#548eae', symbol: 'circle', count: 1 };
  return { label: 'Bad', finish: 'common', color: '#b54740', symbol: 'circle', count: 1 };
}

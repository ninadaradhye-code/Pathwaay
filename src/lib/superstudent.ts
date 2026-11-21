/**
 * Superstudent: a recognition earned from confirmed help, computed from the
 * public leaderboard (no extra data stored).
 *
 * Someone qualifies when they are in the top 10, have at least 5 solves that
 * the asker confirmed, and average 8/10 or more across their ratings. All three
 * matter: rank alone rewards volume, rating alone can come from one session.
 */
export const SUPERSTUDENT_RULE = {
  maxRank: 10,
  minSolved: 5,
  minRating: 8,
} as const;

export function isSuperstudent(rank: number, solved: number, avgRating: number, ratings: number) {
  return (
    rank <= SUPERSTUDENT_RULE.maxRank &&
    solved >= SUPERSTUDENT_RULE.minSolved &&
    ratings > 0 &&
    Number(avgRating) >= SUPERSTUDENT_RULE.minRating
  );
}

export const SUPERSTUDENT_EXPLAINER = `Top ${SUPERSTUDENT_RULE.maxRank}, at least ${SUPERSTUDENT_RULE.minSolved} doubts confirmed solved, and an average rating of ${SUPERSTUDENT_RULE.minRating}/10 or more.`;

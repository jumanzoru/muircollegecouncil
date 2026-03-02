export const CMCW_WORDLE_TIME_ZONE = 'America/Los_Angeles';

export const CMCW_WORDLE_START_DATE = '2026-03-02';
export const CMCW_WORDLE_END_DATE = '2026-03-06';

export type CmcwWordleDaily = {
  answer: string;
  winPopupBody: string;
  moreInfoHandle: string;
  moreInfoUrl: string;
};

export const CMCW_DAILY_BY_DATE: Record<string, CmcwWordleDaily> = {
  '2026-03-02': {
    answer: 'PLANT',
    winPopupBody:
      "Come out Pots and Playlists, today at 5pm in MOM’s Cafe and PLANT some love, bringing home a piece of Muir with you. 💚\n\nMore information can be found on @muircollegecouncil.",
    moreInfoHandle: '@muircollegecouncil',
    moreInfoUrl: 'https://www.instagram.com/p/DVIU_FWFOe7/?img_index=1',
  },
  '2026-03-03': {
    answer: 'BANDS',
    winPopupBody:
      'Are you ready to see talented student BANDS performing at the Muirchella Festival today from 1-4pm on the Muir Quad?\n\nMore information can be found on @muircollegecouncil.',
    moreInfoHandle: '@muircollegecouncil',
    moreInfoUrl: 'https://www.instagram.com/p/DVJrQ8jErp3/',
  },
  '2026-03-04': {
    answer: 'GLOBE',
    winPopupBody:
      'Fly across the GLOBE with us to celebrate the diversity of our college at Global Game Night, happening today from 5-7pm on Muir Lawn!\n\nMore information can be found on @muircollegecouncil.',
    moreInfoHandle: '@muircollegecouncil',
    moreInfoUrl: 'https://www.instagram.com/p/DVJrgAiEhg9/?img_index=1',
  },
  '2026-03-05': {
    answer: 'UNTIL',
    winPopupBody:
      'UNTIL next time Muirons! Celebrating Muir College Week may be coming to an end, but we’re turning out for one last night on the Muir Lawn for the Muirtopia Carnival from 6-8pm tonight!\n\nMore information can be found on @muircollegecouncil.',
    moreInfoHandle: '@muircollegecouncil',
    moreInfoUrl: 'https://www.instagram.com/p/DVJr2TGEtEU/?img_index=1',
  },
  '2026-03-06': {
    answer: 'VINYL',
    winPopupBody:
      'Put that record on and play that VINYL for Muirstock! Tonight, join us for smooth R&B fused with funky dance grooves from Jae Stephens and Essosa at the Epstein Family Amphitheater from 7-10pm.\n\nMore information can be found on @muircollegeofficial.',
    moreInfoHandle: '@muircollegeofficial',
    moreInfoUrl: 'https://www.instagram.com/muircollegeofficial/',
  },
};

export const CMCW_WORDS_BY_DATE: Record<string, string> = Object.fromEntries(
  Object.entries(CMCW_DAILY_BY_DATE).map(([date, daily]) => [date, daily.answer]),
) as Record<string, string>;

function isIsoDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidAnswer(value: string) {
  return /^[A-Z]{5}$/.test(value);
}

export function getCmcwWordleConfigIssues() {
  const issues: string[] = [];

  const keys = Object.keys(CMCW_WORDS_BY_DATE).sort();
  if (!keys.includes(CMCW_WORDLE_START_DATE) || !keys.includes(CMCW_WORDLE_END_DATE)) {
    issues.push('Missing start/end date entries in CMCW_WORDS_BY_DATE.');
  }

  for (const key of keys) {
    if (!isIsoDateKey(key)) issues.push(`Invalid date key format: ${key}`);
    const answer = CMCW_WORDS_BY_DATE[key] ?? '';
    if (!isValidAnswer(answer)) issues.push(`Invalid answer for ${key}. Use 5 letters A–Z.`);
  }

  const answers = keys.map((k) => CMCW_WORDS_BY_DATE[k]).filter(Boolean);
  const uniqueAnswers = new Set(answers);
  if (uniqueAnswers.size !== answers.length) issues.push('Duplicate answers found. Each day must have a distinct word.');

  for (const key of keys) {
    const daily = CMCW_DAILY_BY_DATE[key];
    if (!daily) issues.push(`Missing daily popup content for ${key}.`);
    if (daily && daily.answer !== CMCW_WORDS_BY_DATE[key]) issues.push(`Answer mismatch for ${key}.`);
  }

  return issues;
}

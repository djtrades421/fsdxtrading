/* ==========================================================================
   FSD-X ORB Pro — live track record variants
   One entry per variant that is live as a product. Read by track-record.html
   (public page) and admin.html (Track Record importer).

   Add a variant:   copy an entry, give it a new id + files, set "since".
   Update a variant: add a line to its "versions" list. The last entry is what
                     the page shows as "Now running". The trade list keeps going.
   recent:          how many of the most recent trades the page lists.
                    Stats are always all-time for the variant.

   exits: [code, label, plain-English rule]
     codes: TP1 · TP2 · TRAIL · STOP · EOD  (EOD_EARLY is shown automatically)
   runner: true  -> the importer splits winning exits into TP2 vs Trailed stop
   ========================================================================== */
window.TR_VARIANTS = {
  recent: 50,
  variants: [
    {
      id: 'v1',
      label: 'Variant 1',
      tag: 'Stock',
      desc: 'Stock settings. One target, fixed stop.',
      since: '2025-12-16',
      files: { '400': 'track-record.json', '250': 'track-record-250.json' },
      versions: [
        { label: 'v5',  start: '2025-12-16', note: 'Indicator version.' },
        { label: 'MK2', start: '2026-05-01', note: 'Rebuilt as a strategy.' }
      ],
      runner: false,
      exits: [
        ['TP1',  'Target',     'Price reaches TP1.'],
        ['STOP', 'Stop',       'Price reaches the stop loss.'],
        ['EOD',  'End of day', 'Neither hit. Closed at the session close.']
      ]
    },
    {
      id: 'v2',
      label: 'Variant 2',
      tag: 'Runner',
      desc: 'Holds past TP1 for TP2, trailing the stop once TP1 is reached.',
      since: '2026-10-09',
      files: { '400': 'track-record-v2.json', '250': 'track-record-v2-250.json' },
      versions: [
        { label: 'MK2', start: '2026-10-09', note: 'Runner variant goes live.' },
        { label: 'v1.4.4', start: '2026-10-19', note: 'NinjaTrader 8 build. V2 settings retuned: slower trend read, max 2 trades, 1:00 PM cutoff.' }
      ],
      runner: true,
      exits: [
        ['STOP',  'Stop',         'Stopped before TP1.'],
        ['TRAIL', 'Trailed stop', 'Reached TP1, then the trailing stop closed it. Shows the points it locked in.'],
        ['TP2',   'TP2',          'Ran all the way to TP2.'],
        ['EOD',   'End of day',   'Still open at the session close.']
      ]
    }
  ]
};

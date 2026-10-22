// One-shot palette remap: Character Goods Catalog → Catppuccin (Latte app / Mocha dark).
// Literal, case-insensitive, token-bounded hex + rgba replacements, per file.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'client', 'styles');

const common = {
  'rgba(42, 47, 90': 'rgba(76, 79, 105',
  'rgba(15, 23, 42': 'rgba(52, 54, 74',
  'rgba(14, 26, 43': 'rgba(24, 24, 37',
  'rgba(20, 23, 27': 'rgba(24, 24, 37',
  'rgba(20, 35, 58': 'rgba(30, 30, 46',
  'rgba(12, 8, 32': 'rgba(17, 17, 27',
  'rgba(224, 49, 49': 'rgba(210, 15, 57',
  'rgba(217, 45, 32': 'rgba(210, 15, 57',
  'rgba(255, 110, 110': 'rgba(210, 15, 57',
  'rgba(250, 204, 21': 'rgba(238, 174, 58',
  'rgba(255, 210, 62': 'rgba(238, 174, 58',
  'rgba(255, 197, 61': 'rgba(238, 174, 58',
  'rgba(60, 40, 140': 'rgba(95, 39, 170',
  'rgba(104, 69, 240': 'rgba(136, 57, 239',
  'rgba(91, 61, 245': 'rgba(136, 57, 239',
  'rgba(124, 106, 255': 'rgba(203, 166, 247',
  'rgba(61, 90, 254': 'rgba(30, 102, 245',
  'rgba(46, 144, 220': 'rgba(30, 102, 245',
  'rgba(75, 168, 255': 'rgba(137, 180, 250',
  'rgba(114, 196, 255': 'rgba(137, 180, 250',
  'rgba(207, 49, 120': 'rgba(136, 57, 239',
  'rgba(255, 107, 167': 'rgba(136, 57, 239',
  'rgba(255, 246, 232': 'rgba(239, 241, 245',
  'rgba(107, 63, 168': 'rgba(166, 49, 116',
  'rgba(56, 178, 172': 'rgba(23, 146, 153',
  'rgba(47, 179, 68': 'rgba(47, 125, 31',
  'rgba(47, 158, 95': 'rgba(47, 125, 31',
};

const perFile = {
  'callroom.css': {
    // dark chrome → Mocha ladder (crust / mantle / base / surface0 / surface1)
    '#0a0b0f': '#11111b', '#0d0e12': '#11111b', '#0f1116': '#11111b',
    '#121419': '#181825', '#14161c': '#181825', '#14161d': '#181825', '#15171d': '#181825',
    '#161920': '#181825', '#171a21': '#181825',
    '#1a1d24': '#1e1e2e', '#1b1e25': '#1e1e2e', '#1d2028': '#1e1e2e', '#1d2029': '#1e1e2e',
    '#1e2129': '#1e1e2e', '#21252e': '#1e1e2e',
    '#23262e': '#313244', '#232730': '#313244', '#24262e': '#313244', '#242832': '#313244',
    '#262a34': '#313244', '#262a35': '#313244', '#262b36': '#313244', '#272b35': '#313244',
    '#2a2e3a': '#313244', '#2a2f3b': '#313244', '#2c303a': '#313244', '#2d313b': '#313244',
    '#2d313c': '#313244', '#2e323d': '#313244', '#2f3441': '#313244', '#35305c': '#313244',
    '#2a2e38': '#45475a', '#343844': '#45475a', '#3a3f4d': '#45475a', '#3a3f4c': '#45475a',
    '#4a4f62': '#45475a', '#4b4380': '#45475a', '#1d1b33': '#181825',
    // text tiers on dark → Mocha text/subtext/overlay
    '#9aa0ad': '#a6adc8', '#8d93a1': '#9399b2', '#7c8290': '#7f849c', '#767c8a': '#6c7086',
    '#5b6170': '#585b70', '#cfd3dc': '#bac2de', '#dfe2ea': '#cdd6f4', '#eef0f5': '#cdd6f4',
    '#d5d8e0': '#bac2de', '#cbd0da': '#a6adc8', '#c7cad4': '#a6adc8', '#aeb4c1': '#9399b2',
    '#b9bec9': '#9399b2', '#a8aebb': '#7f849c', '#c3c7d2': '#45475a', '#d6dae0': '#bac2de',
    '#e6e8ee': '#cdd6f4', '#f3f4f8': '#cdd6f4', '#f1f2f6': '#cdd6f4',
    // action blue → Latte blue
    '#3d5afe': '#1e66f5', '#324fe0': '#1450c4', '#2b3f8f': '#1450c4', '#344aa8': '#1e66f5',
    '#eef1ff': '#cdd6f4',
    // lavender/mauve accents on dark
    '#b9c6ff': '#b4befe', '#c8d3ff': '#b4befe', '#a9a0ff': '#b4befe', '#c6bfff': '#b4befe',
    '#d9d3ff': '#b4befe', '#e6e1ff': '#cdd6f4', '#7c6aff': '#cba6f7', '#5b4bdb': '#8839ef',
    // semantic on dark → Mocha hues
    '#ff9a9a': '#f38ba8', '#ff9c9c': '#f38ba8', '#ff8a8a': '#f38ba8', '#ff6b6b': '#f38ba8',
    '#ff8f8f': '#f38ba8', '#f2c3c7': '#f5c2e7', '#f0c9c9': '#f5c2e7', '#ff9a90': '#f5c2e7',
    '#e03131': '#d20f39', '#c92a2a': '#a80d2d',
    '#f0b429': '#f9e2af', '#ffe08a': '#f9e2af',
    '#46b37b': '#a6e3a1', '#2fb344': '#a6e3a1', '#2f9e44': '#a6e3a1', '#2f8f5c': '#a6e3a1',
    '#3f9d6a': '#a6e3a1', '#8ee6e0': '#94e2d5',
    '#4a2327': '#45202b', '#5a3535': '#45202b', '#4a2d2d': '#45202b', '#4a2a2a': '#45202b',
    '#3a2323': '#45202b', '#2c1b1b': '#311219', '#2c1618': '#311219',
    '#f0dfb4': '#f5dfb6', '#e8d9b6': '#f5dfb6',
    'rgba(255, 176, 80': 'rgba(250, 179, 135', 'rgba(240, 165, 58': 'rgba(250, 179, 135',
  },
  'learn.css': {
    // violet heroes / accents → mauve family
    '#42279f': '#5f27aa', '#5a35b8': '#7530d1', '#7a4fe0': '#8839ef', '#8a68ff': '#a873f4',
    '#6845f0': '#8839ef', '#5b3ce8': '#9354f1', '#4a3a8f': '#5f27aa', '#3a2b78': '#4a1d9e',
    '#453a86': '#5f27aa', '#2c2552': '#4a2093', '#a47add': '#a873f4', '#c8a9ed': '#c39df7',
    '#d9c8ff': '#dcc5fb', '#e5d6ff': '#dcc5fb', '#efe4ff': '#ece4fb', '#f0e8ff': '#ece4fb',
    '#f6f1ff': '#f4ecfe',
    // ambers / golds → Latte gold
    '#f58a1f': '#df8e1e', '#f0a200': '#eeae3a', '#c76a0a': '#b57010', '#e5aa22': '#df8e1e',
    '#ffd75e': '#f6c667', '#f2c14e': '#eeae3a', '#f0c355': '#eeae3a', '#fff5c4': '#fdf3e2',
    '#fff1d4': '#fdf3e2', '#4a2d00': '#402b00',
    '#c98400': '#a96510', '#b8860b': '#a96510', '#b47706': '#a96510', '#a85f05': '#a96510',
    '#7e4603': '#7a4a00', '#8a5a00': '#7a4a00',
    // pinks / soft reds → pink family
    '#f3a0bb': '#ea76cb', '#f7c9d0': '#fbe9f3', '#ffe0e9': '#fbe9f3', '#ffe9ed': '#fbe9f3',
    '#fff2f4': '#fbe9f3', '#96261b': '#99231a',
    // blues → Latte blue
    '#2d66d6': '#1e66f5', '#1d4aa8': '#1450c4', '#1a4aa8': '#1450c4',
    '#bfe3f7': '#c6d8f8', '#ccd8eb': '#c6d8f8', '#d4f7ff': '#e2ebfa', '#e5f8ff': '#e2ebfa',
    '#e2f4ff': '#e2ebfa', '#f2fbff': '#f6f8fc', '#a3d7ef': '#209fb5', '#88bfe8': '#209fb5',
    '#71c6dc': '#209fb5',
    // neutrals → Latte slate
    '#a9b2c0': '#9ca0b0', '#d5dde8': '#ccd0da', '#f1f5fc': '#f6f8fc',
    '#2ed3b7': '#179299',
  },
  'pages.css': {
    '#cf3178': '#8839ef', '#c3cde0': '#ccd0da', '#aab6c8': '#9ca0b0', '#bcd9f7': '#c6d8f8',
    '#b7ecd8': '#bce0af', '#17b26a': '#2f7d1f', '#14233a': '#1e1e2e',
    '#f58a1f': '#df8e1e', '#f0a200': '#eeae3a', '#c76a0a': '#b57010',
  },
  'public.css': {
    '#fff8e6': '#fdf3e2', '#f2e0b0': '#f5dfb6', '#f2b2b6': '#f7c6df', '#c3cde0': '#ccd0da',
    '#aab6c8': '#9ca0b0', '#0a111d': '#34364a', '#f58a1f': '#df8e1e',
  },
  'exam.css': {
    '#aeb4be': '#9ca0b0', '#c3c8d0': '#ccd0da', '#f0a53a': '#df8e1e', '#f6c26b': '#f6c667',
    '#f6f1ef': '#f6f8fc', '#a33a2c': '#99231a', '#7a6a65': '#7c7f93', '#fff4f2': '#fde5ea',
    '#ffb3ab': '#f8c2cd', '#ff9a8f': '#f8c2cd', '#ff7a6e': '#f2939b', '#e4b9b3': '#f8c2cd',
    '#e3d7d3': '#e6e9ef', '#d6dae0': '#ccd0da', '#14171b': '#1e1e2e',
  },
  'exam-tools.css': {
    '#fff8e6': '#fdf3e2', '#ffe9a8': '#fadd9e', '#f2e0b0': '#f5dfb6', '#f0a200': '#eeae3a',
    '#fdecec': '#fde5ea', '#f2b0b0': '#f8c2cd', '#e7f8ef': '#e4f3de', '#c9f2dc': '#bce0af',
    '#9fd9b8': '#bce0af', '#c22c3c': '#b00e2e', '#12864f': '#2f7d1f', '#1c1533': '#3b1a7a',
  },
  'mentor.css': {
    '#0f0a26': '#2f1163', '#171033': '#3b1a7a', '#221a4a': '#4a2093', '#241a52': '#4a2093',
    '#3a2b78': '#5f27aa',
    '#ffd9a8': '#fadd9e',
    '#d83838': '#d20f39', '#ff6b6b': '#f2939b', '#ff9d9d': '#f8c2cd', '#ff9c9c': '#f8c2cd',
    '#ff8a8a': '#f8c2cd',
  },
  'notifications.css': {
    '#5b4bdb': '#8839ef', '#6d5bd0': '#7530d1', '#ddd8ea': '#dcc5fb',
    '#f7f5fc': '#f4ecfe', '#f7f4ff': '#f4ecfe', '#f1ecff': '#f4ecfe',
    '#faf8ff': '#f6f8fc', '#f8f6fc': '#f6f8fc', '#f6f4fb': '#f6f8fc',
  },
  'earnings.css': {
    '#5b4bdb': '#8839ef', '#7c6aff': '#7530d1', '#eeeaff': '#ece0fd',
    '#fff4d8': '#fdf3e2', '#ffe9e4': '#fdeee7', '#e3f7ec': '#e4f3de',
    '#b04331': '#99231a', '#9a6b00': '#7a4a00', '#1f7a4d': '#2f7d1f',
  },
  'speaking-partner.css': {
    '#fdecec': '#fde5ea', '#f3b4b4': '#f8c2cd',
  },
  'tutor.css': {
    '#fdecec': '#fde5ea', '#f3c6c3': '#f8c2cd', '#d92d20': '#d20f39',
  },
  'refresh.css': {
    // dark theme ground: ink navy → Mocha
    '#0a111d': '#11111b', '#0f172a': '#11111b', '#0d1524': '#181825', '#0f1f36': '#181825',
    '#20173a': '#181825', '#162033': '#1e1e2e', '#1a263c': '#1e1e2e', '#1b2740': '#1e1e2e',
    '#223049': '#313244', '#2a3a5a': '#313244', '#2d3a52': '#313244', '#234574': '#313244',
    '#45367a': '#45475a',
  },
  'certificate.css': {
    '#5b4bdb': '#7530d1', // the one blue accent on the sheet
  },
};

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let changedFiles = 0;
let totalRepl = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.css') && f !== 'globals.css' && f !== 'fonts.css')) {
  const map = { ...common, ...(perFile[file] || {}) };
  const full = path.join(DIR, file);
  let text = fs.readFileSync(full, 'utf8');
  const before = text;
  for (const [from, to] of Object.entries(map)) {
    const isHex = from.startsWith('#');
    const pattern = isHex
      ? new RegExp(`(?<![0-9a-fA-F])${escapeRe(from)}(?![0-9a-fA-F])`, 'gi')
      : new RegExp(escapeRe(from), 'g');
    text = text.replace(pattern, to);
  }
  if (text !== before) {
    const count = (before.match(/#/g) || []).length - (text.match(/#/g) || []).length;
    fs.writeFileSync(full, text);
    changedFiles += 1;
    totalRepl += count;
    console.log(`${file}: updated`);
  }
}
console.log(`files changed: ${changedFiles}`);

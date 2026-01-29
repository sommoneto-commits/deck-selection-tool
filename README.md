# Magic Swiss Tournament Monte Carlo Simulator

A 100% static single-file HTML tool that runs Monte Carlo simulations of Swiss-format Magic: The Gathering tournaments. No backend required, no server needed - just open the HTML file in any browser.

## Features

- **Single File**: Everything in one `index.html` - just download and open
- **Monte Carlo Simulation**: Run up to 500,000 tournament simulations
- **Data Preview**: See first 5 rows of loaded data to verify parsing
- **Swiss Pairing**: Approximates real Swiss pairing with point-based groupings
- **Top 8 Bracket**: Optional single-elimination bracket simulation
- **Non-blocking UI**: Simulation runs in batches to keep UI responsive
- **Flexible Input**: Upload CSV/XLSX files or paste data directly
- **Auto-detection**: Automatically detects percentage scales (0-1 vs 0-100)
- **Comprehensive Stats**: P(Win), P(Top 8), Expected MW%, configurable win thresholds
- **Export**: Download results as CSV or JSON
- **Charts**: Visual bar charts for key metrics
- **Built-in Example Data**: Test immediately with "Load Example" buttons

## Quick Start

### Option 1: Just Open It

1. Download `index.html`
2. Double-click to open in your browser
3. Click "Load Example" on both cards to load test data
4. Click "Run Simulation"

### Option 2: GitHub Pages

1. Fork or clone this repository
2. Go to **Settings** → **Pages**
3. Under "Source", select **Deploy from a branch**
4. Choose `main` branch and `/ (root)` folder
5. Your site will be live at `https://yourusername.github.io/repo-name/`

## Input Data Format

### Metagame Data (A)

CSV or XLSX with the following columns:

| Column | Required | Description |
|--------|----------|-------------|
| `archetype` | Yes | Deck name |
| `meta_pct` | Yes | Metagame share (%) |
| `draw_pct` | No | Draw rate (%), default 3% |
| `skill_adj` | No | Skill adjustment (-0.5 to 0.5), default 0 |

**Example:**
```csv
archetype,meta_pct,draw_pct,skill_adj
Mono Red Aggro,18.5,1.5,0
Azorius Control,14.2,9.8,0.02
Golgari Midrange,12.8,4.5,0
```

### Matchup Matrix (B)

CSV or XLSX with:
- First column: Player deck name
- Other columns: Opponent deck names
- Cell values: Win percentage (P(win | no draw))

**Example:**
```csv
,Mono Red Aggro,Azorius Control,Golgari Midrange
Mono Red Aggro,50,42,48
Azorius Control,58,50,52
Golgari Midrange,52,48,50
```

### Data Notes

- **Percentage Scale**: Automatically detects 0-100 or 0-1 scale
- **Normalization**: `meta_pct` values are normalized to sum to 1.0
- **Mirror Matches**: Default to 50% if not specified
- **Missing Matchups**: Fallback to 50%

## Simulation Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Players | 800 | 8-10,000 | Number of players per tournament |
| Rounds | 14 | 1-20 | Number of Swiss rounds |
| Trials | 10,000 | 100-500,000 | Number of tournaments to simulate |
| Seed | Random | Any integer | Optional seed for reproducibility |
| Cut Top 8 | Yes | Checkbox | Simulate single-elimination bracket |

## Output Metrics

| Metric | Description |
|--------|-------------|
| P(Win Tournament) | Probability of winning the entire event |
| P(Top 8) | Probability of making Top 8 cut |
| Avg Points | Average Swiss points (W=3, D=1, L=0) |
| Expected MW% | Expected match win percentage |
| Most Common Record | Most frequently occurring W-D-L record |
| P(≥X Wins) | Configurable win thresholds (default: 9, 10, 11, 12) |

## Technical Details

### Simulation Algorithm

1. **Field Generation**: Players sampled from metagame distribution
2. **Swiss Pairing**: Group by points → shuffle → pair within groups → float odd players down
3. **Match Resolution**:
   - Draw check: `P(draw) = clamp((draw_i + draw_j) / 2)`
   - Win check: `P(win) = logistic(matchup_winrate + skill_diff * 4)`
4. **Tiebreakers**: TB1 = sum of opponents' points, TB2 = random
5. **Top 8 Bracket**: 1v8, 4v5, 2v7, 3v6 (no draws allowed)

### Performance

- Runs in batches of 100 trials to keep UI responsive
- Uses seeded PRNG (Mulberry32) for reproducibility
- Object pooling for players to reduce memory allocation

## Browser Support

Tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Libraries Used (via CDN)

- [PapaParse](https://www.papaparse.com/) - CSV parsing
- [SheetJS](https://sheetjs.com/) - XLSX parsing
- [Chart.js](https://www.chartjs.org/) - Data visualization

## File Structure

```
├── index.html      # Single-file application (HTML + CSS + JS)
└── README.md       # This file
```

## License

MIT License - Feel free to use, modify, and distribute.

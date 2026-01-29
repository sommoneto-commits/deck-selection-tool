# Magic Swiss Tournament Monte Carlo Simulator

A 100% static (HTML/CSS/JS) tool that runs Monte Carlo simulations of Swiss-format Magic: The Gathering tournaments. No backend required - works entirely in your browser and can be deployed to GitHub Pages.

## Features

- **Monte Carlo Simulation**: Run up to 1,000,000 tournament simulations
- **Swiss Pairing**: Approximates real Swiss pairing with point-based groupings
- **Top 8 Bracket**: Optional single-elimination bracket simulation
- **Web Worker**: Non-blocking simulation with progress bar and cancel support
- **Flexible Input**: Upload CSV/XLSX files or paste data directly
- **Auto-detection**: Automatically detects percentage scales (0-1 vs 0-100)
- **Comprehensive Stats**: P(Win), P(Top 8), Expected MW%, Win thresholds
- **Export**: Download results as CSV or JSON
- **Charts**: Visual bar charts for key metrics

## Quick Start

### Option 1: GitHub Pages Deployment

1. Fork or clone this repository
2. Go to your repository **Settings** → **Pages**
3. Under "Source", select **Deploy from a branch**
4. Choose `main` branch and `/ (root)` folder
5. Click **Save**
6. Your site will be live at `https://yourusername.github.io/repo-name/`

### Option 2: Local Usage

Simply open `index.html` in a modern web browser. No server required.

> **Note**: Some browsers may block Web Workers when opening files directly. If you encounter issues, use a local server:
> ```bash
> # Python 3
> python -m http.server 8000
>
> # Node.js
> npx serve .
> ```
> Then open `http://localhost:8000`

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
- **Missing Matchups**: Fallback to weighted average winrate

## Simulation Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Players | 800 | Number of players per tournament |
| Rounds | 14 | Number of Swiss rounds |
| Trials | 100,000 | Number of tournaments to simulate |
| Seed | Random | Optional seed for reproducibility |
| Cut Top 8 | Yes | Simulate single-elimination bracket |

## Output Metrics

| Metric | Description |
|--------|-------------|
| P(Win Tournament) | Probability of winning the entire event |
| P(Top 8) | Probability of making Top 8 cut |
| Avg Points | Average Swiss points (W=3, D=1, L=0) |
| Expected MW% | Expected match win percentage |
| Most Common Record | Most frequently occurring W-D-L record |
| P(≥X Wins) | Configurable win thresholds |

## Technical Details

### Simulation Algorithm

1. **Field Generation**: Players sampled from metagame distribution
2. **Swiss Pairing**: Group by points → shuffle → pair within groups
3. **Match Resolution**:
   - Draw check: `P(draw) = clamp((draw_i + draw_j) / 2)`
   - Win check: `P(win) = logistic(matchup + skill_diff)`
4. **Tiebreakers**: TB1 = sum of opponents' points, TB2 = random
5. **Top 8 Bracket**: 1v8, 4v5, 2v7, 3v6 (no draws)

### Performance

- Uses Web Worker for non-blocking simulation
- Optimized PRNG (Mulberry32)
- Object pooling for players
- Progress updates every 1% of trials

## File Structure

```
├── index.html      # Main HTML with embedded CSS
├── app.js          # Application logic (parsing, UI, charts)
├── worker.js       # Web Worker (simulation engine)
└── README.md       # This file
```

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

## License

MIT License - Feel free to use, modify, and distribute.

## Contributing

Contributions welcome! Please open an issue or PR.

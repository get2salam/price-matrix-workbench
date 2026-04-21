# 📊 Price Matrix Optimizer

A browser-based pricing workflow for parts-heavy businesses. Upload sales data, test margin targets, review tier-by-tier recommendations, and export a cleaner matrix without sending business data to a server.

![Price Matrix Optimizer](docs/price-matrix-preview.svg)

---

## ✨ Features

- **Flexible CSV intake** — Import POS exports with auto-detected headers and currency-formatted values
- **Sample file included** — Try the flow instantly with `public/sample-parts-data.csv`
- **Editable price matrix** — Tune ranges, multipliers, and gross profit targets directly in the UI
- **Matrix health checks** — Spot gaps, overlaps, tier counts, and open-ended ranges before running analysis
- **Quick target presets** — Jump to common growth, margin, or dollar-profit goals
- **Interactive recommendations** — Lock manual overrides and let the rest of the tiers rebalance
- **Export-ready output** — Download CSV, generate a text report, or copy the results into your POS workflow
- **Local-first workflow** — Saved settings stay in browser storage and shop data never leaves the machine

## 🛠 Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | React 19                            |
| Build Tool  | Vite 7                              |
| Charts      | Recharts 3                          |
| Styling     | Tailwind CSS 3                      |
| Linting     | ESLint 9 with React Hooks plugin    |
| Container   | Docker (Node 20 Alpine + Nginx)     |

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### Install & Run

```bash
# Clone the repository
git clone https://github.com/get2salam/price-matrix-workbench.git
cd price-matrix-workbench

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at **http://localhost:5173**.

### Build for Production

```bash
npm run build
npm run preview   # preview the production build locally
```

### Quality Check

```bash
npm run check
```

This runs linting, tests, and a production build in one command.

### Docker

```bash
# Build and run with Docker Compose
docker compose up --build

# Or manually
docker build -t price-matrix-optimizer .
docker run -p 8080:80 price-matrix-optimizer
```

The containerized app serves on **http://localhost:8080**.

## 📖 How It Works

1. **Define your price matrix** — Set cost-range tiers (e.g. $0–$1.50, $1.51–$6.00, …) with target multipliers and gross profit percentages.

2. **Upload sales data** — Import a CSV export from your shop management system, or start with the included sample CSV. The parser auto-detects header rows and handles currency-formatted values (`$1,234.56`).

3. **Set a profit target** — Choose between percentage growth, target margin, or a fixed dollar increase.

4. **Receive recommendations** — The optimizer distributes price adjustments across tiers using a weighted algorithm:
   - **60% volume weight** — Tiers with higher revenue share receive proportionally larger adjustments (bigger impact).
   - **40% headroom weight** — Tiers with lower current margins get more room to increase without hitting price sensitivity.
   - **Safety caps** — No tier increases more than 50%, and gross profit is capped at 95%.
   - **Convergence loop** — An iterative solver nudges multipliers until projected profit matches the target (within 0.5% tolerance).

5. **Fine-tune & export** — Manually override any tier's multiplier; the optimizer redistributes the remaining tiers to still hit your target. Export the final matrix as CSV, a printable report, or copy directly to your clipboard.

## 📁 Project Structure

```
├── docs/                # README visuals
├── public/              # Static assets and sample CSV
├── src/
│   ├── components/      # UI building blocks, including lazy-loaded charts
│   ├── utils/           # Parser and pricing helpers
│   ├── __tests__/       # Vitest coverage for parser, math, and app flows
│   ├── App.jsx          # Main application component
│   └── main.jsx         # React entry point
├── Dockerfile           # Multi-stage Docker build
├── docker-compose.yml   # Container orchestration
├── eslint.config.js     # ESLint flat config
├── Makefile             # Common development commands
└── package.json
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the [MIT License](LICENSE).

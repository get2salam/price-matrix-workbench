import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const chartCopy = {
  distribution: {
    title: 'Parts distribution data',
    description: 'Parts count by cost tier from the uploaded CSV.',
  },
  comparison: {
    title: 'Multiplier comparison data',
    description: 'Current and recommended multipliers by cost tier.',
  },
};

const formatRange = (tier) => `$${tier.minCost}-${tier.maxCost === 999999 ? 'Maximum' : `$${tier.maxCost}`}`;

function ChartDataTable({ variant, data }) {
  const copy = chartCopy[variant] || chartCopy.comparison;

  return (
    <table className="sr-only" aria-label={copy.title}>
      <caption>{copy.description}</caption>
      <thead>
        <tr>
          <th scope="col">Cost tier</th>
          <th scope="col">Parts</th>
          {variant === 'comparison' && (
            <>
              <th scope="col">Current multiplier</th>
              <th scope="col">Recommended multiplier</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {data.map((tier) => (
          <tr key={`chart-summary-${variant}-${tier.id}`}>
            <th scope="row">Tier {tier.id}: {formatRange(tier)}</th>
            <td>{tier.partCount}</td>
            {variant === 'comparison' && (
              <>
                <td>{tier.multiplier.toFixed(2)}x</td>
                <td>{tier.newMultiplier.toFixed(2)}x</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ChartSection({ variant, data, colors = [] }) {
  if (!data?.length) {
    return null;
  }

  const copy = chartCopy[variant] || chartCopy.comparison;

  if (variant === 'distribution') {
    return (
      <figure className="h-full">
        <div className="h-full" role="img" aria-label={`${copy.title}: ${copy.description}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="id"
                stroke="#64748b"
                tickFormatter={(id) => {
                  const tier = data.find((item) => item.id === id);
                  return tier ? `$${tier.minCost}-${tier.maxCost === 999999 ? '+' : tier.maxCost}` : '';
                }}
              />
              <YAxis stroke="#64748b" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '0.5rem' }}
                labelFormatter={(id) => {
                  const tier = data.find((item) => item.id === id);
                  return tier ? `Cost Range: ${formatRange(tier)}` : '';
                }}
              />
              <Bar dataKey="partCount" name="Parts Count" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`distribution-cell-${entry.id}`} fill={colors[index % colors.length] || '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ChartDataTable variant={variant} data={data} />
      </figure>
    );
  }

  return (
    <figure className="h-full">
      <div className="h-full" role="img" aria-label={`${copy.title}: ${copy.description}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis type="number" stroke="#64748b" domain={[0, 'auto']} />
            <YAxis
              type="category"
              dataKey="id"
              stroke="#64748b"
              width={100}
              tickFormatter={(id) => {
                const tier = data.find((item) => item.id === id);
                return tier ? `$${tier.minCost}-${tier.maxCost === 999999 ? '+' : tier.maxCost}` : '';
              }}
            />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '0.5rem' }} />
            <Legend />
            <Bar dataKey="multiplier" name="Current" fill="#64748b" radius={[0, 4, 4, 0]} />
            <Bar dataKey="newMultiplier" name="Recommended" fill="#10b981" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable variant={variant} data={data} />
    </figure>
  );
}

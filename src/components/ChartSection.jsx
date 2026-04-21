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

export default function ChartSection({ variant, data, colors = [] }) {
  if (!data?.length) {
    return null;
  }

  if (variant === 'distribution') {
    return (
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
              return tier ? `Cost Range: $${tier.minCost} - $${tier.maxCost === 999999 ? 'Maximum' : tier.maxCost}` : '';
            }}
          />
          <Bar dataKey="partCount" name="Parts Count" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`distribution-cell-${entry.id}`} fill={colors[index % colors.length] || '#10b981'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
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
  );
}

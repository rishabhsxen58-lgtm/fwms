import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function WorkloadChart({ data }) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: -20, right: 8, top: 5, bottom: 20 }}>
    <CartesianGrid stroke="#edf0f4" vertical={false} />
    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" />
    <YAxis tick={{ fontSize: 11 }} />
    <Tooltip formatter={(value) => [`${value} hours`, "Weekly workload"]} />
    <Bar dataKey="hours" fill="#3269d6" radius={[4, 4, 0, 0]} />
  </BarChart></ResponsiveContainer></div>;
}

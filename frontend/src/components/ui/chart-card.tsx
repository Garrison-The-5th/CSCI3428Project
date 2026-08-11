/**
 * File: chart-card.tsx
 * Description: Chart card for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import { ArrowTrendingUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import type { ApexOptions } from 'apexcharts';
import { useState } from 'react';
import ReactApexChart from 'react-apexcharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';

const chartData: Record<string, number[]> = {
  'Last 7 days': [31, 40, 28, 51, 42, 109, 100],
  'Last 30 days': [50, 60, 45, 70, 65, 90, 120, 110, 95, 130],
  Yesterday: [80],
  Today: [45],
};

const chartOptions: ApexOptions = {
  chart: { type: 'area', height: 200, toolbar: { show: false }, sparkline: { enabled: false } },
  colors: ['var(--color-purple)'],
  dataLabels: { enabled: false },
  fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.2 } },
  grid: { show: false },
  stroke: { curve: 'smooth', width: 2 },
  tooltip: { x: { show: false } },
  xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { show: false },
};

const ChartCard = () => {
  const [selected, setSelected] = useState('Last 7 days');
  const [open, setOpen] = useState(false);

  return (
    <Card className="dashboard-card-2 col-span-2 border-gray-300 bg-light-gray shadow-lg">
      <CardHeader className="mb-2 flex-row items-start justify-between gap-4">
        <div>
          <h5 className="text-2xl font-semibold">32.4k</h5>
          <p className="text-sm text-text-secondary">Users this week</p>
        </div>
        <Badge variant="outline" className="gap-1 border-green/30 text-green">
          <ArrowTrendingUpIcon className="size-4" />
          12%
        </Badge>
      </CardHeader>

      <CardContent>
        <ReactApexChart
          height={200}
          options={chartOptions}
          series={[{ name: 'Users', data: chartData[selected] }]}
          type="area"
        />
      </CardContent>

      <CardFooter className="justify-between border-t border-gray-300 pt-4">
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-sm font-medium text-text-secondary hover:text-heading"
            onClick={() => setOpen(!open)}
            type="button"
          >
            {selected}
            <ChevronDownIcon className="size-4" />
          </Button>
          {open && (
            <ul
              className="absolute z-10 mt-1 w-44 rounded-lg border border-gray-200 bg-white text-sm
                shadow-lg"
            >
              {Object.keys(chartData).map((option) => (
                <li key={option}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-none px-3 py-2 text-left"
                    onClick={() => {
                      setSelected(option);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    {option}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <a className="inline-flex items-center gap-1 text-sm font-medium text-green" href="#">
          Users Report
        </a>
      </CardFooter>
    </Card>
  );
};

export default ChartCard;

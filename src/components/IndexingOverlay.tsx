/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Compass } from "lucide-react";

export type IndexingPhase = "catalog" | "notes" | "finishing";

export interface IndexingProgressState {
  phase: IndexingPhase;
  completed: number;
  total: number;
  currentBookTitle?: string;
}

interface IndexingOverlayProps {
  progress: IndexingProgressState;
}

const PHASE_LABELS: Record<IndexingPhase, string> = {
  catalog: "正在加载书架与阅读统计",
  notes: "正在同步书籍划线",
  finishing: "正在整理阅读数据"
};

export default function IndexingOverlay({ progress }: IndexingOverlayProps) {
  const { phase, completed, total, currentBookTitle } = progress;
  const showBar = phase === "notes" && total > 0;
  const percent = showBar ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const phaseLabel = PHASE_LABELS[phase];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FAF9F6]/95 z-40 font-sans px-6">
      <div className="relative mb-4">
        <Compass className="w-12 h-12 text-[#2C2C26]/40 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#2C2C26] font-normal font-serif">
          阅
        </div>
      </div>

      <p className="text-sm font-serif text-[#2C2C26]/80 tracking-normal text-center">
        {phaseLabel}
      </p>

      {showBar && (
        <div className="w-full max-w-md mt-5 space-y-2">
          <div className="h-1.5 w-full rounded-full bg-[#2C2C26]/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#2C2C26]/70 transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-sans text-[#2C2C26]/55 uppercase tracking-widest">
            <span>{completed} / {total} 本书</span>
            <span>{percent}%</span>
          </div>
        </div>
      )}

      {currentBookTitle && phase === "notes" && (
        <p className="text-xs font-sans text-[#2C2C26]/50 mt-3 max-w-md text-center truncate">
          当前：{currentBookTitle}
        </p>
      )}

      <p className="text-[10px] font-sans text-[#2C2C26]/40 mt-4 uppercase tracking-widest font-semibold">
        首次同步可能需要一两分钟
      </p>
    </div>
  );
}
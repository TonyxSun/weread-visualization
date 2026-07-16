/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Compass, Quote, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, BrainCircuit } from "lucide-react";
import { WeReadNotebook, WeReadHighlight, WeReadOverallStats } from "./types";
import {
  fetchNotebooks,
  fetchOverallStats,
  fetchBookNotes,
  fetchAiAnalysis,
  getStoredAnalysisApiConfig,
  getServerAnalysisStatus,
  SERVER_SYNC_ENABLED,
  fetchSnapshot,
  triggerSync,
  pollSyncUntilDone
} from "./api";
import { mapServerPhaseToOverlay } from "./components/IndexingOverlay";
import InfiniteCanvas from "./components/InfiniteCanvas";
import GrowthMap from "./components/GrowthMap";
import CognitiveLandscape from "./components/CognitiveLandscape";
import RelationshipMap from "./components/RelationshipMap";
import CardSwiper from "./components/CardSwiper";
import ReadingTrends from "./components/ReadingTrends";
import IndexingOverlay, { IndexingProgressState } from "./components/IndexingOverlay";
import { getNotebookTimeInfo } from "./utils/wereadDates";

/** WeRead-only publish shell (Obsidian import removed). */
type DataMode = "weread";
const DATA_MODE: DataMode = "weread";
type HighlightWithBook = WeReadHighlight & { bookName: string; bookAuthor: string; bookCover: string };

interface CachedModeData {
  notebooks: WeReadNotebook[];
  stats: WeReadOverallStats | null;
  highlights: HighlightWithBook[];
  yearlyPersonality: Array<{
    year: number;
    title: string;
    annualQuestion?: string;
    visualArchetype?: string;
    artPersona?: string;
    personaReason?: string;
    description: string;
  }>;
  thoughtClusters: Array<{ keyword: string; books: string[]; thoughtQuote: string }>;
  isAiGenerated: boolean;
  analysisConnected: boolean;
  analysisModel: string;
}

interface StoredAnalysis {
  yearlyPersonality: CachedModeData["yearlyPersonality"];
  thoughtClusters: Array<{ keyword: string; books: string[]; thoughtQuote: string }>;
  isAiGenerated: boolean;
  analysisConnected: boolean;
  analysisModel: string;
  sourceSignature?: string;
}

const ANALYSIS_CACHE_PREFIX = "reading_analysis_result_v1";
const LAST_ANALYSIS_KEY_PREFIX = "reading_analysis_last_v1";
const VISUAL_PERSONA_BY_ARCHETYPE: Record<string, string> = {
  "凝视": "蒙娜丽莎",
  "沉思": "圣杰罗姆",
  "辩思": "柏拉图",
  "落地": "亚里士多德",
  "盛放": "维纳斯",
  "繁生": "芙洛拉",
  "守护": "圣母",
  "野性": "巴克斯",
  "质疑": "圣托马斯",
  "决断": "朱迪斯",
  "召唤": "马太",
  "加冕": "伊丽莎白一世",
  "孤绝": "圣方济各"
};

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildAnalysisCacheKey(mode: DataMode, books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  // Server-managed analysis; cache by data signature only (no client endpoint/key).
  return `${ANALYSIS_CACHE_PREFIX}:${mode}:${hashString(buildAnalysisSourceSignature(books, highlights))}`;
}

function buildAnalysisSourceSignature(books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const bookPart = books.map((nb) => [
    nb.bookId,
    nb.book?.title,
    nb.book?.author,
    nb.book?.readUpdateTime,
    nb.book?.finishReading,
    nb.noteCount
  ].join(":")).join("|");
  const highlightPart = highlights.map((h) => [
    h.bookId,
    h.bookmarkId,
    h.createTime,
    h.markText?.slice(0, 80)
  ].join(":")).join("|");
  return hashString(`${bookPart}::${highlightPart}`);
}

function getNotebookYear(notebook: WeReadNotebook, index = 0): number {
  return getNotebookTimeInfo(notebook, index).year;
}

function inferAnnualQuestion(books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const text = [
    ...books.map((nb) => `${nb.book?.title || ""} ${nb.book?.category || ""}`),
    ...highlights.map((h) => h.markText || "")
  ].join(" ");
  if (/自由|边界|关系/.test(text)) return "自由与边界如何共存";
  if (/秩序|规则|习惯|系统/.test(text)) return "秩序如何从混乱中生成";
  if (/真实|真相|证据|怀疑/.test(text)) return "经验能否抵达真相";
  if (/权力|治理|商业|组织/.test(text)) return "权力如何塑造现实";
  if (/孤独|存在|死亡|命运/.test(text)) return "孤独如何保存清醒";
  if (/爱|家庭|伦理|照护/.test(text)) return "关系如何保存自我";
  if (/欲望|冲突|反抗|革命/.test(text)) return "欲望如何改变判断";
  return "旧答案为何失效";
}

function inferVisualArchetype(title: string, books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const text = [
    title,
    ...books.map((nb) => `${nb.book?.title || ""} ${nb.book?.author || ""} ${nb.book?.category || ""}`),
    ...highlights.map((h) => h.markText || "")
  ].join(" ");
  if (/怀疑|证据|真实|真相|批判|逻辑|科学|技术|方法|结构/.test(text)) return "质疑";
  if (/权力|治理|战略|管理|组织|商业|经济|投资|决策/.test(text)) return "加冕";
  if (/冲突|反抗|愤怒|决裂|革命|越界|欲望/.test(text)) return "决断";
  if (/孤独|退隐|荒原|远方|沉默|死亡|存在/.test(text)) return "孤绝";
  if (/关系|照护|伦理|家庭|母亲|共情|责任/.test(text)) return "守护";
  if (/哲学|理念|抽象|本质|形而上|意义/.test(text)) return "辩思";
  if (/自由|美|身体|艺术|爱情|感受/.test(text)) return "盛放";
  if (/实践|现实|经验|规则|习惯|落地/.test(text)) return "落地";
  if (/ENFP|ESFP/.test(title)) return "繁生";
  if (/ENTP|ESTP/.test(title)) return "野性";
  if (/ISTJ|INTP/.test(title)) return "沉思";
  return "凝视";
}

function normalizeYearlyPersonality(
  rawItems: any[],
  books: WeReadNotebook[],
  highlights: HighlightWithBook[]
): CachedModeData["yearlyPersonality"] {
  const booksByYear = new Map<number, WeReadNotebook[]>();
  books.forEach((book, index) => {
    const year = getNotebookYear(book, index);
    booksByYear.set(year, [...(booksByYear.get(year) || []), book]);
  });

  const byYear = new Map<number, any>();
  (rawItems || []).forEach((item) => {
    const year = Number(item?.year);
    if (Number.isFinite(year)) byYear.set(year, item);
  });

  return Array.from(booksByYear.keys()).sort((a, b) => b - a).map((year) => {
    const item = byYear.get(year) || { year };
    const yearBooks = booksByYear.get(year) || [];
    const yearBookIds = new Set(yearBooks.map((book) => book.bookId));
    const yearHighlights = highlights.filter((highlight) => yearBookIds.has(highlight.bookId));
    const title = String(item?.title || "INFJ").toUpperCase().match(/\b[EI][NS][TF][JP]\b/)?.[0] || "INFJ";
    const visualArchetype = VISUAL_PERSONA_BY_ARCHETYPE[item?.visualArchetype]
      ? item.visualArchetype
      : inferVisualArchetype(title, yearBooks, yearHighlights);
    const artPersona = VISUAL_PERSONA_BY_ARCHETYPE[visualArchetype] || item?.artPersona || "蒙娜丽莎";
    const firstBook = yearBooks[0]?.book?.title ? `《${yearBooks[0].book.title}》` : "这一年的书目";

    return {
      year,
      title,
      annualQuestion: item?.annualQuestion || inferAnnualQuestion(yearBooks, yearHighlights),
      visualArchetype,
      artPersona,
      personaReason: item?.personaReason || `${firstBook}与划线内容共同指向${visualArchetype}这一视觉人格，因此对应${artPersona}的精神姿态。`,
      description: item?.description || `${title} 来自这一年的阅读主题、书籍分布与划线密度，显示你在意义、秩序和自我边界之间重新校准理解方式。`
    };
  });
}

function normalizeAnalysisShape(
  analysis: StoredAnalysis | any,
  books: WeReadNotebook[],
  highlights: HighlightWithBook[]
): StoredAnalysis | any {
  if (!analysis) return analysis;
  return {
    ...analysis,
    yearlyPersonality: normalizeYearlyPersonality(analysis.yearlyPersonality || [], books, highlights),
    thoughtClusters: Array.isArray(analysis.thoughtClusters) ? analysis.thoughtClusters : []
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

export default function App() {
  const [loading, setLoading] = useState<boolean>(true);
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"canvas" | "swiper">("canvas");

  // State elements
  const [notebooks, setNotebooks] = useState<WeReadNotebook[]>([]);
  const [stats, setStats] = useState<WeReadOverallStats | null>(null);
  const [highlights, setHighlights] = useState<HighlightWithBook[]>([]);
  
  // AI Analyzed States
  const [yearlyPersonality, setYearlyPersonality] = useState<CachedModeData["yearlyPersonality"]>([]);
  const [thoughtClusters, setThoughtClusters] = useState<Array<{ keyword: string; books: string[]; thoughtQuote: string }>>([]);
  const [isAiGenerated, setIsAiGenerated] = useState<boolean>(false);
  const [analysisModel, setAnalysisModel] = useState<string>(() => getStoredAnalysisApiConfig().model || "本地语义分析");
  const [analysisConnected, setAnalysisConnected] = useState<boolean>(false);
  const [analysisRetrying, setAnalysisRetrying] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const dataCacheRef = useRef<Partial<Record<DataMode, CachedModeData>>>({});
  const analysisRunRef = useRef(0);
  /** Server has ANALYSIS_*, XAI_*, or GEMINI env — model is "connected" even before first generation. */
  const serverAnalysisReadyRef = useRef(false);

  useEffect(() => {
    // Read-only model label + connection from server env (never visitor config).
    void getServerAnalysisStatus().then((st) => {
      if (st.hasServerAnalysisKey) {
        serverAnalysisReadyRef.current = true;
        setAnalysisConnected(true);
      }
      if (st.serverModel) {
        setAnalysisModel((prev) =>
          !prev || prev === "本地语义分析" ? st.serverModel! : prev
        );
      }
    });
  }, []);

  const applyCachedData = (cached: CachedModeData) => {
    setNotebooks(cached.notebooks);
    setStats(cached.stats);
    setHighlights(cached.highlights);
    setYearlyPersonality(cached.yearlyPersonality);
    setThoughtClusters(cached.thoughtClusters);
    setIsAiGenerated(cached.isAiGenerated);
    setAnalysisConnected(cached.analysisConnected);
    setAnalysisModel(cached.analysisModel);
  };

  const saveCachedData = (targetMode: DataMode, data: CachedModeData) => {
    dataCacheRef.current[targetMode] = data;
  };

  const readStoredAnalysis = (targetMode: DataMode, activeBooks: WeReadNotebook[], activeHighlights: HighlightWithBook[]): StoredAnalysis | null => {
    try {
      const exactKey = buildAnalysisCacheKey(targetMode, activeBooks, activeHighlights);
      const fallbackKey = `${LAST_ANALYSIS_KEY_PREFIX}:${targetMode}`;
      const exactRaw = localStorage.getItem(exactKey);
      if (exactRaw) {
        const parsed = JSON.parse(exactRaw);
        if (!parsed?.isAiGenerated) return null;
        return normalizeAnalysisShape(parsed, activeBooks, activeHighlights);
      }

      const fallbackRaw = localStorage.getItem(fallbackKey);
      if (!fallbackRaw) return null;
      const fallback = JSON.parse(fallbackRaw);
      if (!fallback?.isAiGenerated) return null;
      return normalizeAnalysisShape(fallback, activeBooks, activeHighlights);
    } catch (error) {
      console.warn("Failed to read local analysis cache.", error);
      return null;
    }
  };

  const writeStoredAnalysis = (targetMode: DataMode, activeBooks: WeReadNotebook[], activeHighlights: HighlightWithBook[], analysis: StoredAnalysis) => {
    try {
      const payload = JSON.stringify({
        ...analysis,
        sourceSignature: buildAnalysisSourceSignature(activeBooks, activeHighlights),
        savedAt: Date.now()
      });
      localStorage.setItem(
        buildAnalysisCacheKey(targetMode, activeBooks, activeHighlights),
        payload
      );
      localStorage.setItem(`${LAST_ANALYSIS_KEY_PREFIX}:${targetMode}`, payload);
    } catch (error) {
      console.warn("Failed to write local analysis cache.", error);
    }
  };

  const getCurrentSnapshot = (overrides: Partial<CachedModeData> = {}): CachedModeData => ({
    notebooks,
    stats,
    highlights,
    yearlyPersonality,
    thoughtClusters,
    isAiGenerated,
    analysisConnected,
    analysisModel,
    ...overrides
  });

  const runAnalysisForData = async (
    targetMode: DataMode,
    activeBooks: WeReadNotebook[],
    activeHighlights: HighlightWithBook[],
    baseSnapshot?: CachedModeData
  ) => {
    if (activeBooks.length === 0) return;
    const runId = ++analysisRunRef.current;
    const serverReady = serverAnalysisReadyRef.current;

    try {
      setAnalysisRetrying(true);
      setAnalysisError(null);
      // Keep green "connected" if server owns the model; only clear for true offline/local-only.
      if (!serverReady) setAnalysisConnected(false);

      const analysis = normalizeAnalysisShape(
        await fetchAiAnalysis(activeBooks, activeHighlights),
        activeBooks,
        activeHighlights
      );
      if (runId !== analysisRunRef.current) return;

      const previousSnapshot = baseSnapshot || dataCacheRef.current[targetMode];
      const isFallback = !analysis?.isAiGenerated;
      const hasPreviousAiData = !!previousSnapshot?.isAiGenerated
        && previousSnapshot.yearlyPersonality.every((item) => item.annualQuestion && item.visualArchetype && item.artPersona && item.personaReason);
      const shouldKeepPrevious = isFallback && hasPreviousAiData;
      const connected =
        serverReady
        || shouldKeepPrevious
        || !!analysis?.isAiGenerated
        || analysis?.analysisProvider === "configured";

      const nextSnapshot: CachedModeData = {
        ...(previousSnapshot || getCurrentSnapshot({
          notebooks: activeBooks,
          highlights: activeHighlights
        })),
        notebooks: activeBooks,
        highlights: activeHighlights,
        yearlyPersonality: shouldKeepPrevious ? previousSnapshot!.yearlyPersonality : (analysis?.yearlyPersonality || []),
        thoughtClusters: shouldKeepPrevious ? previousSnapshot!.thoughtClusters : (analysis?.thoughtClusters || []),
        isAiGenerated: shouldKeepPrevious ? true : !!analysis?.isAiGenerated,
        analysisConnected: connected,
        analysisModel: shouldKeepPrevious
          ? previousSnapshot!.analysisModel
          : (analysis?.analysisModel || (serverReady ? analysisModel : getStoredAnalysisApiConfig().model) || "本地语义分析")
      };

      if (nextSnapshot.isAiGenerated) {
        writeStoredAnalysis(targetMode, activeBooks, activeHighlights, {
          yearlyPersonality: nextSnapshot.yearlyPersonality,
          thoughtClusters: nextSnapshot.thoughtClusters,
          isAiGenerated: nextSnapshot.isAiGenerated,
          analysisConnected: nextSnapshot.analysisConnected,
          analysisModel: nextSnapshot.analysisModel
        });
      }

      saveCachedData(targetMode, nextSnapshot);
      applyCachedData(nextSnapshot);
    } catch (error: any) {
      if (runId === analysisRunRef.current) {
        const message = error?.message || "分析暂时不可用，请稍后重试。";
        setAnalysisError(message);
        // Server still has a configured model even if this request failed.
        setAnalysisConnected(serverAnalysisReadyRef.current);
      }
    } finally {
      if (runId === analysisRunRef.current) {
        setAnalysisRetrying(false);
      }
    }
  };

  /** Kick off personality analysis after books load (skip if cache already has AI result). */
  const maybeAutoAnalyze = (
    books: WeReadNotebook[],
    activeHighlights: HighlightWithBook[],
    baseSnapshot?: CachedModeData
  ) => {
    if (!books.length) return;
    if (baseSnapshot?.isAiGenerated && (baseSnapshot.yearlyPersonality?.length || 0) > 0) {
      return;
    }
    void runAnalysisForData(DATA_MODE, books, activeHighlights, baseSnapshot);
  };

  const shuffleHighlights = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const loadDataWeReadServerSync = async (options: { force?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    setIndexingProgress(null);

    try {
      const snapshot = await fetchSnapshot();
      const highlights = shuffleHighlights(
        (snapshot.highlights || []).map((h) => ({
          ...h,
          bookName: h.bookName || "",
          bookAuthor: h.bookAuthor || "",
          bookCover: h.bookCover || ""
        })) as HighlightWithBook[]
      );
      const cachedAnalysis = readStoredAnalysis("weread", snapshot.notebooks || [], highlights);
      const snapshotData: CachedModeData = {
        notebooks: snapshot.notebooks || [],
        stats: snapshot.stats as WeReadOverallStats | null,
        highlights,
        yearlyPersonality: [],
        thoughtClusters: [],
        isAiGenerated: false,
        analysisConnected: serverAnalysisReadyRef.current,
        analysisModel: analysisModel || getStoredAnalysisApiConfig().model || "本地语义分析",
        ...(cachedAnalysis || {})
      };
      if (serverAnalysisReadyRef.current) {
        snapshotData.analysisConnected = true;
      }
      saveCachedData("weread", snapshotData);
      applyCachedData(snapshotData);
      setLoading(false);
      // Analyze as soon as we have shelf data (don't wait for full highlight sync).
      maybeAutoAnalyze(snapshotData.notebooks, snapshotData.highlights, snapshotData);

      const syncStart = await triggerSync(Boolean(options.force));
      const syncRunId = syncStart.syncRunId;

      try {
        sessionStorage.setItem("weread_active_sync_run_id", String(syncRunId));
        const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("weread_sync") : null;
        bc?.postMessage({ type: "syncRunId", syncRunId });
        bc?.close();
      } catch { /* ignore */ }

      const finalStatus = await pollSyncUntilDone(syncRunId, (p) => {
        if (p.status === "done") {
          setIndexingProgress(null);
          return;
        }
        if (p.status === "error") {
          setIndexingProgress(null);
          setError(p.error || "后台同步失败");
          return;
        }
        setIndexingProgress({
          phase: mapServerPhaseToOverlay(p.phase),
          completed: p.booksDone,
          total: p.booksTotal,
          currentBookTitle: p.currentBookTitle,
          backgroundSync: true
        });
      });

      if (finalStatus.status === "done") {
        const fresh = await fetchSnapshot();
        const freshHighlights = shuffleHighlights(
          (fresh.highlights || []).map((h) => ({
            ...h,
            bookName: h.bookName || "",
            bookAuthor: h.bookAuthor || "",
            bookCover: h.bookCover || ""
          })) as HighlightWithBook[]
        );
        const prev = dataCacheRef.current.weread || snapshotData;
        const refreshed: CachedModeData = {
          ...snapshotData,
          ...prev,
          notebooks: fresh.notebooks || [],
          stats: fresh.stats as WeReadOverallStats | null,
          highlights: freshHighlights,
          analysisConnected: serverAnalysisReadyRef.current || prev.analysisConnected,
          ...(readStoredAnalysis("weread", fresh.notebooks || [], freshHighlights) || {})
        };
        saveCachedData("weread", refreshed);
        applyCachedData(refreshed);
        // Re-run if we still have no AI personality after full sync (more highlight context).
        if (!refreshed.isAiGenerated) {
          maybeAutoAnalyze(refreshed.notebooks, refreshed.highlights, refreshed);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("404") || message.includes("disabled")) {
        await loadDataLegacyWeRead(options);
        return;
      }
      throw err;
    } finally {
      setIndexingProgress(null);
    }
  };

  const loadDataLegacyWeRead = async (options: { force?: boolean } = {}) => {
      setIndexingProgress({
        phase: "catalog",
        completed: 0,
        total: 0
      });

      const [notebooksRes, statsRes] = await Promise.all([
        fetchNotebooks(),
        fetchOverallStats()
      ]);

      const books = notebooksRes.books;
      const notesCompletedRef = { current: 0 };

      setIndexingProgress({
        phase: "notes",
        completed: 0,
        total: books.length
      });

      const notesByBook = await mapWithConcurrency(books, 2, async (bookItem) => {
        setIndexingProgress({
          phase: "notes",
          completed: notesCompletedRef.current,
          total: books.length,
          currentBookTitle: bookItem.book.title
        });

        try {
          const notesRes = await fetchBookNotes(bookItem.bookId);
          const mapped = (notesRes.updated || []).map((h) => ({
            ...h,
            bookName: bookItem.book.title,
            bookAuthor: bookItem.book.author,
            bookCover: bookItem.book.cover
          }));
          notesCompletedRef.current += 1;
          setIndexingProgress({
            phase: "notes",
            completed: notesCompletedRef.current,
            total: books.length,
            currentBookTitle: bookItem.book.title
          });
          return mapped;
        } catch (e) {
          console.warn(`Failed downloading notes for ${bookItem.bookId}`, e);
          notesCompletedRef.current += 1;
          setIndexingProgress({
            phase: "notes",
            completed: notesCompletedRef.current,
            total: books.length,
            currentBookTitle: bookItem.book.title
          });
          return [];
        }
      });

      setIndexingProgress({
        phase: "finishing",
        completed: books.length,
        total: books.length
      });

      const resolvedHighlights = notesByBook.flat();
      const shuffled = shuffleHighlights(resolvedHighlights);
      const cachedAnalysis = readStoredAnalysis("weread", notebooksRes.books, shuffled);
      const snapshot: CachedModeData = {
        notebooks: notebooksRes.books,
        stats: statsRes,
        highlights: shuffled,
        yearlyPersonality: [],
        thoughtClusters: [],
        isAiGenerated: false,
        analysisConnected: serverAnalysisReadyRef.current,
        analysisModel: analysisModel || getStoredAnalysisApiConfig().model || "本地语义分析",
        ...(cachedAnalysis || {})
      };
      if (serverAnalysisReadyRef.current) snapshot.analysisConnected = true;
      saveCachedData("weread", snapshot);
      applyCachedData(snapshot);
      maybeAutoAnalyze(snapshot.notebooks, snapshot.highlights, snapshot);
  };

  const loadData = async (options: { force?: boolean } = {}) => {
    let usedServerSync = false;
    try {
      if (!options.force && dataCacheRef.current[DATA_MODE]) {
        const cached = dataCacheRef.current[DATA_MODE]!;
        applyCachedData(cached);
        setError(null);
        setLoading(false);
        if (!cached.isAiGenerated) {
          maybeAutoAnalyze(cached.notebooks, cached.highlights, cached);
        }
        return;
      }

      setLoading(true);
      setError(null);
      setIndexingProgress(null);

      if (SERVER_SYNC_ENABLED) {
        usedServerSync = true;
        await loadDataWeReadServerSync(options);
        return;
      }

      await loadDataLegacyWeRead(options);
      setLoading(false);

    } catch (err: any) {
      console.error(err);
      setError(err?.message || "无法拉取阅读数据，请稍后重试。");
    } finally {
      if (!usedServerSync) {
        setIndexingProgress(null);
      }
      setLoading(false);
    }
  };

  const deleteBookById = async (bookId: string | null) => {
    if (!bookId) return;

    const nextBooks = notebooks.filter((nb) => nb.bookId !== bookId);
    const nextHighlights = highlights.filter((h) => h.bookId !== bookId);

    setNotebooks(nextBooks);
    setHighlights(nextHighlights);
    setSelectedBookId(null);
    saveCachedData(DATA_MODE, getCurrentSnapshot({
      notebooks: nextBooks,
      highlights: nextHighlights
    }));

    if (nextBooks.length === 0) {
      setYearlyPersonality([]);
      setThoughtClusters([]);
      setIsAiGenerated(false);
      setAnalysisConnected(false);
    }
  };

  const deleteSelectedBook = async () => {
    await deleteBookById(selectedBookId);
  };

  const retryAnalysis = async () => {
    if (notebooks.length === 0) return;
    await runAnalysisForData(DATA_MODE, notebooks, highlights);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input") ||
        target?.closest("textarea") ||
        target?.closest("select") ||
        target?.closest("[contenteditable='true']")
      ) {
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedBookId) {
        event.preventDefault();
        deleteSelectedBook();
      }
      if (event.key === "Escape") {
        setSelectedBookId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBookId, notebooks, highlights]);

  return (
    <div className="w-screen h-screen flex flex-col font-sans text-ink-dark bg-[#FAF9F6]">
      
      {/* Top Desk Bar */}
      <header className="h-14 border-b border-[#2C2C26]/10 bg-white/40 backdrop-blur-md flex items-center justify-between gap-2 px-3 sm:px-6 z-[120] shadow-2xs flex-shrink-0">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <div className="flex min-w-0 flex-col">
            <h1 className="font-serif font-normal text-sm md:text-base tracking-tight text-[#2C2C26] flex items-center gap-1.5 leading-none truncate">
              我的阅读数据图谱
            </h1>
            <p className="hidden sm:block text-[9px] text-[#2C2C26]/45 uppercase tracking-widest font-sans mt-0.5">
              Insights Interface
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
          {/* Mobile: canvas vs cards — must fully hide the other pane (see main layout below). */}
          <div
            className="flex items-center rounded-lg bg-[#2C2C26]/5 p-0.5 text-xs sm:hidden"
            role="tablist"
            aria-label="视图切换"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "canvas"}
              onClick={() => setTab("canvas")}
              className={`px-2.5 py-1.5 rounded-md transition-all font-sans text-[10px] font-medium tracking-wide cursor-pointer ${
                tab === "canvas" ? "bg-white text-ink-dark shadow-xs" : "text-[#2C2C26]/60"
              }`}
            >
              图谱
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "swiper"}
              onClick={() => setTab("swiper")}
              className={`px-2.5 py-1.5 rounded-md transition-all font-sans text-[10px] font-medium tracking-wide cursor-pointer ${
                tab === "swiper" ? "bg-white text-ink-dark shadow-xs" : "text-[#2C2C26]/60"
              }`}
            >
              划线
            </button>
          </div>

          <button
            type="button"
            onClick={() => loadData({ force: true })}
            disabled={loading}
            className="flex items-center gap-2 px-2.5 sm:px-3 py-2 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded-md shadow-sm font-sans text-xs transition-all duration-300 cursor-pointer disabled:opacity-50"
            title="拉取并更新最新划线与书籍数据"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{loading ? "同步中..." : "同步数据"}</span>
          </button>
        </div>
      </header>

      {/* Main split work space */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative bg-[#FAF9F6]">
        
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FAF9F6] z-40 text-center p-6 font-sans">
            <AlertCircle className="w-14 h-14 text-red-600/60 mb-4" />
            <h3 className="font-serif font-normal text-lg text-ink-dark mb-1">
              数据暂时不可用
            </h3>
            <p className="text-xs text-[#2C2C26]/70 max-w-sm leading-relaxed mb-6 font-sans">
              {error}
            </p>
            <button
              onClick={() => loadData({ force: true })}
              className="px-4 py-2 bg-[#2C2C26] hover:bg-[#2C2C26]/90 text-white text-xs tracking-wider font-sans rounded border border-[#2C2C26]/20 shadow-xs flex items-center gap-1.5 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重新尝试
            </button>
          </div>
        ) : (
          <>
            {loading && !indexingProgress?.backgroundSync && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FAF9F6]/95 z-40 font-sans">
                <div className="relative">
                  <Compass className="w-12 h-12 text-[#2C2C26]/40 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#2C2C26] font-normal font-serif">
                    阅
                  </div>
                </div>
                <p className="text-sm font-serif text-[#2C2C26]/80 mt-4 tracking-normal">
                  正在解构数据图谱并检索心智线索...
                </p>
              </div>
            )}
            {indexingProgress && (
              <IndexingOverlay progress={indexingProgress} />
            )}
            {(!loading || indexingProgress?.backgroundSync) && (
          <>
            {/* LEFT STAGE: Infinite Canvas — full pane on mobile when tab=canvas */}
            <div
              className={`relative min-h-0 ${
                tab === "canvas"
                  ? "flex flex-1 flex-col h-full"
                  : "hidden sm:block sm:flex-1 sm:h-full"
              }`}
            >
                <InfiniteCanvas onBlankClick={() => setSelectedBookId(null)}>
                  
                  {/* Floating source indicator in canvas - left-aligned with content blocks at left 100px */}
                  <div className="absolute" style={{ left: "100px", top: "30px", zIndex: 40 }}>
                    <div className="flex items-center gap-2">
                    <div className="bg-white/85 backdrop-blur-md px-3.5 py-1.5 border border-[#2C2C26]/12 rounded-full text-[10px] font-medium font-sans flex items-center gap-2 shadow-2xs pointer-events-none">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${notebooks.length > 0 ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${notebooks.length > 0 ? "bg-emerald-600" : "bg-amber-600"}`}></span>
                      </span>
                      <span className="text-[#2C2C26]/85">数据源：微信读书（{notebooks.length}本）</span>
                    </div>
                    <div className="bg-white/85 backdrop-blur-md px-3.5 py-1.5 border border-[#2C2C26]/12 rounded-full text-[10px] font-medium font-sans flex items-center gap-2 shadow-2xs">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${analysisConnected ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${analysisConnected ? "bg-emerald-600" : "bg-amber-600"}`}></span>
                      </span>
                      <BrainCircuit className="w-3 h-3 text-[#2C2C26]/55" />
                      <span className="max-w-[260px] truncate text-[#2C2C26]/85" title={analysisModel}>
                        分析模型：{analysisModel}
                        {!analysisConnected ? "（未配置）" : !isAiGenerated && analysisRetrying ? "（生成中…）" : !isAiGenerated ? "（已连接）" : ""}
                      </span>
                      {notebooks.length > 0 && (
                        <button
                          type="button"
                          onClick={retryAnalysis}
                          disabled={analysisRetrying}
                          className="ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#2C2C26]/10 bg-white hover:bg-[#2C2C26]/5 disabled:opacity-50 text-[#2C2C26]/70 cursor-pointer pointer-events-auto"
                          title="重新生成年度阅读人格"
                        >
                          <RefreshCw className={`w-3 h-3 ${analysisRetrying ? "animate-spin" : ""}`} />
                          {analysisRetrying ? "分析中" : "重试"}
                        </button>
                      )}
                    </div>
                    {analysisError && (
                      <div className="bg-red-50/95 backdrop-blur-md px-3.5 py-1.5 border border-red-200 rounded-full text-[10px] font-medium font-sans flex items-center gap-2 shadow-2xs max-w-[520px]">
                        <AlertCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
                        <span className="truncate text-red-700" title={analysisError}>
                          分析失败：{analysisError}
                        </span>
                      </div>
                    )}
                    </div>
                  </div>

                  {/* Adaptive flowing layout wrapper for blocks to prevent any overlaps or truncation */}
                  <div className="absolute left-[100px] top-[80px] w-[5900px] flex gap-[140px]">
                    {/* LEFT COLUMN: GROWTH MAP */}
                    <div className="w-[2300px] flex-shrink-0">
                      <GrowthMap
                        notebooks={notebooks}
                        yearlyPersonality={yearlyPersonality}
                        isAiGenerated={isAiGenerated}
                        analysisConnected={analysisConnected}
                        onReanalyze={retryAnalysis}
                        isAnalyzing={analysisRetrying}
                        selectedBookId={selectedBookId}
                        onSelectBook={setSelectedBookId}
                        onDeleteBook={deleteBookById}
                      />
                    </div>

                    {/* MIDDLE+RIGHT: READING TRENDS & EVOLUTION MAP side-by-side, then COGNITIVE LANDSCAPE below */}
                    <div className="flex-shrink-0 flex flex-col gap-[120px]">
                      <div className="flex gap-[140px] items-stretch">
                        <div className="w-[1700px] flex-shrink-0">
                          <ReadingTrends
                            notebooks={notebooks}
                            stats={stats}
                            highlights={highlights}
                            onReanalyze={retryAnalysis}
                            isAnalyzing={analysisRetrying}
                          />
                        </div>
                        <div className="w-[1700px] flex-shrink-0">
                          <RelationshipMap
                            thoughtClusters={thoughtClusters}
                            notebooks={notebooks}
                            highlights={highlights}
                            onReanalyze={retryAnalysis}
                            isAnalyzing={analysisRetrying}
                          />
                        </div>
                      </div>
                      <div className="w-full">
                        <CognitiveLandscape
                          notebooks={notebooks}
                          highlights={highlights}
                          preferCategory={stats?.preferCategory || []}
                          onReanalyze={retryAnalysis}
                          isAnalyzing={analysisRetrying}
                        />
                      </div>
                    </div>
                  </div>

                </InfiniteCanvas>

              {/* Collapsible Panel Hover Area & Toggle Button */}
              <div className="absolute right-0 top-0 hidden h-full w-14 z-40 sm:flex items-center justify-end group">
                <button
                  type="button"
                  onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
                  aria-expanded={!rightPanelCollapsed}
                  aria-label={rightPanelCollapsed ? "展开划线卡片" : "收起划线卡片"}
                  className="mr-0 flex h-24 w-8 items-center justify-center rounded-l-lg border border-r-0 border-[#2C2C26]/18 bg-white/92 text-[#2C2C26]/58 shadow-sm backdrop-blur-md transition-all duration-200 opacity-0 translate-x-2 group-hover:translate-x-0 group-hover:opacity-100 hover:bg-[#FAF9F6] hover:text-[#2C2C26] focus:translate-x-0 focus:opacity-100 cursor-pointer"
                  title={rightPanelCollapsed ? "展开划线卡片" : "收起划线卡片"}
                >
                  {rightPanelCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* RIGHT STAGE: cards — on mobile ONLY when tab=swiper (was always w-full and crushed the canvas) */}
            <div
              className={`border-[#2C2C26]/10 bg-white/40 flex-col items-center justify-center relative flex-shrink-0 z-20 transition-all duration-300 ease-in-out border-l min-h-0 ${
                tab === "swiper"
                  ? "flex w-full flex-1 h-full"
                  : rightPanelCollapsed
                    ? "hidden sm:flex w-0 border-l-0 overflow-hidden"
                    : "hidden sm:flex sm:w-[410px]"
              }`}
            >
              
              {/* Vertical clip representing handcraft wire ties */}
              <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-[#2C2C26]/10"></div>

              <div className="w-full h-full flex flex-col items-center justify-center p-6">
                {highlights.length > 0 ? (
                  <CardSwiper notebooks={notebooks} highlights={highlights} />
                ) : (
                  <div className="py-20 text-center text-[#2C2C26]/60 font-serif max-w-xs px-6">
                    <Quote className="w-8 h-8 mx-auto mb-3 opacity-30 text-[#2C2C26]" />
                    <p className="text-sm">暂无图书划线记忆</p>
                    <p className="text-[10px] font-sans text-gray-400 mt-1 leading-relaxed">
                      同步的书籍中还没有划线内容。点击右上角「同步数据」刷新，或稍后再来。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
            )}
          </>
        )}
      </div>

    </div>
  );
}

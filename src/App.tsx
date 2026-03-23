/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Search, Loader2, Globe, Network, AlertCircle, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SitemapNode {
  name: string;
  url: string;
  children?: SitemapNode[];
}

export default function App() {
  const [url, setUrl] = useState('https://finreal.pl');
  const [mapType, setMapType] = useState<'visual' | 'simple'>('visual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SitemapNode | null>(null);
  const [totalNodes, setTotalNodes] = useState(0);
  const [progress, setProgress] = useState(0);
  const [selectedNode, setSelectedNode] = useState<SitemapNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const countNodes = (node: SitemapNode): number => {
    let count = 1;
    if (node.children) {
      node.children.forEach(child => count += countNodes(child));
    }
    return count;
  };

  const handleCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setData(null);
    setTotalNodes(0);
    setProgress(5);

    const interval = setInterval(() => {
      setProgress((prev) => (prev < 95 ? prev + Math.random() * 5 : prev));
    }, 1500);

    console.log(`Starting crawl for: ${url}`);
    try {
      const apiPath = window.location.pathname.replace(/\/$/, '') + '/api/crawl';
      const response = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Nie udało się przeskanować strony');
      }

      const result = await response.json();
      setData(result);
      setTotalNodes(countNodes(result));
      setProgress(100);
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas skanowania');
      setProgress(0);
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (data && svgRef.current) {
      renderTree(data);
    }
  }, [data, mapType]);

  // Expose helpers to D3
  (window as any).openPreview = (nodeData: string) => {
    setSelectedNode(JSON.parse(nodeData));
  };

  (window as any).handleImageError = (img: HTMLImageElement) => {
    if (img.dataset.errorHandled) return;
    img.dataset.errorHandled = 'true';
    img.style.display = 'none';
    const parent = img.parentElement;
    if (parent) {
      parent.classList.add('flex', 'items-center', 'justify-center');
      const div = document.createElement('div');
      div.className = 'text-slate-300 text-[10px] font-bold uppercase';
      div.textContent = 'Brak podglądu';
      parent.appendChild(div);
    }
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Blokujemy domyślny scroll strony, gdy kursor jest nad SVG
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || true) { // Zawsze blokujemy scroll nad płótnem, by nie uciekał
        e.preventDefault();
      }
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', handleWheel);
    };
  }, [data]);

  const renderTree = (rootData: SitemapNode) => {
    if (!rootData || !rootData.name) return;
    const nodeCount = countNodes(rootData);
    
    // Node dimensions based on type
    const isVisual = mapType === 'visual';
    const nodeWidth = 220;
    const nodeHeight = isVisual ? 80 : 40;
    
    const width = Math.max(1200, (nodeCount || 1) * (isVisual ? 150 : 60));
    const height = Math.max(800, (nodeCount || 1) * (isVisual ? 200 : 80));
    const margin = { top: 100, right: 100, bottom: 100, left: 100 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g');

    // Vertical tree layout
    const tree = d3.tree<SitemapNode>().nodeSize([nodeWidth + 40, nodeHeight + (isVisual ? 100 : 60)]);

    const root = d3.hierarchy(rootData);
    tree(root);

    // Color scale for depths
    const colors = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];

    // Links with curved lines (Vertical)
    g.selectAll('.link')
      .data(root.links())
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', '#CBD5E1')
      .attr('stroke-width', 2)
      .attr('d', d3.linkVertical<any, any>()
        .x((d: any) => d.x || 0)
        .y((d: any) => d.y || 0)
      );

    // Nodes
    const node = g.selectAll('.node')
      .data(root.descendants())
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', (d: any) => `translate(${(d.x || 0) - nodeWidth / 2},${d.y || 0})`);

    if (isVisual) {
      const foreignObject = node.append('foreignObject')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('x', 0)
        .attr('y', 0);

      const container = foreignObject.append('xhtml:div')
        .attr('style', (d: any) => `
          width: ${nodeWidth}px; 
          height: ${nodeHeight}px; 
          background-color: ${d.data.isCategory ? '#F8FAFC' : 'white'};
          border-left: 6px solid ${d.data.isCategory ? '#1E293B' : colors[d.depth % colors.length]};
        `)
        .attr('class', (d: any) => `border-2 ${d.data.isCategory ? 'border-slate-400' : 'border-slate-200'} rounded-xl shadow-md overflow-hidden flex flex-col hover:border-blue-400 hover:shadow-xl transition-all duration-300 cursor-default`);

      // Info Area
      const info = container.append('xhtml:div')
        .attr('class', 'p-3 flex-1 flex flex-col justify-center overflow-hidden');

      info.append('xhtml:p')
        .attr('class', (d: any) => `text-[13px] ${d.data.isCategory ? 'font-black uppercase tracking-wider text-slate-900' : 'font-bold text-slate-700'} truncate mb-1`)
        .text((d: any) => d.data.name);

      const footer = info.append('xhtml:div')
        .attr('class', 'flex items-center justify-between mt-1');
      
      footer.append('xhtml:a')
        .attr('href', (d: any) => d.data.url)
        .attr('target', '_blank')
        .attr('class', (d: any) => `text-[10px] ${d.data.isCategory ? 'text-slate-500' : 'text-blue-500'} hover:underline font-mono truncate max-w-[160px]`)
        .text((d: any) => d.data.isCategory ? 'KATALOG' : d.data.url.replace(/^https?:\/\//, ''));

      footer.append('xhtml:div')
        .attr('class', (d) => `w-2 h-2 rounded-full ${d.children?.length ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`);
    } else {
      // Simple List View
      node.append('circle')
        .attr('r', 6)
        .attr('fill', (d) => d.children?.length ? '#3B82F6' : '#94A3B8')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

      node.append('text')
        .attr('dy', '0.31em')
        .attr('x', 12)
        .attr('text-anchor', 'start')
        .attr('font-size', '12px')
        .attr('font-weight', '500')
        .attr('fill', '#1E293B')
        .text((d) => d.data.name)
        .clone(true).lower()
        .attr('stroke', 'white')
        .attr('stroke-width', 3);
    }
      
    // Add zoom behavior with extended limits
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.01, 10])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom as any);
    
    // Initial zoom to fit
    svg.call(zoom.transform as any, d3.zoomIdentity.translate(width / 2, margin.top).scale(0.5));
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Network className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">VisualSitemap</h1>
            {totalNodes > 0 && (
              <div className="ml-4 flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold border border-blue-100">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                Zaindeksowano {totalNodes} stron
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Input Section */}
        <div className="max-w-3xl mx-auto mb-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">
              Odkryj architekturę swojej witryny
            </h2>
            <p className="text-lg text-slate-500 max-w-xl mx-auto">
              Wpisz adres URL, aby wygenerować interaktywną mapę strony z podglądem na żywo.
            </p>
          </motion.div>

          <form onSubmit={handleCrawl} className="space-y-6">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Globe className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
              </div>
              <input
                ref={inputRef}
                type="url"
                placeholder="https://twoja-strona.pl"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="block w-full pl-12 pr-32 py-5 bg-white border-2 border-slate-200 rounded-2xl shadow-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-lg"
              />
              <button
                type="submit"
                disabled={loading}
                className="absolute right-2 top-2 bottom-2 px-8 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-blue-300 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                {loading ? 'Skanowanie...' : 'Generuj mapę'}
              </button>
            </div>
            
            <div className="flex items-center justify-center gap-8">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${mapType === 'visual' ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                  {mapType === 'visual' && <div className="w-2 h-2 bg-white rounded-full" />}
                </div>
                <input 
                  type="radio" 
                  name="mapType" 
                  className="hidden"
                  checked={mapType === 'visual'} 
                  onChange={() => setMapType('visual')}
                />
                <span className={`text-sm font-bold transition-colors ${mapType === 'visual' ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'}`}>Wizualny (z obrazami)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${mapType === 'simple' ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                  {mapType === 'simple' && <div className="w-2 h-2 bg-white rounded-full" />}
                </div>
                <input 
                  type="radio" 
                  name="mapType" 
                  className="hidden"
                  checked={mapType === 'simple'} 
                  onChange={() => setMapType('simple')}
                />
                <span className={`text-sm font-bold transition-colors ${mapType === 'simple' ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'}`}>Prosta lista (szybka)</span>
              </label>
            </div>
          </form>

          {/* Progress Bar */}
          <AnimatePresence>
            {loading && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-8"
              >
                <div className="flex justify-between text-sm font-bold text-slate-600 mb-3">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    Analizowanie struktury...
                  </span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden border border-slate-100 shadow-inner">
                  <motion.div 
                    className="bg-blue-600 h-full shadow-[0_0_15px_rgba(37,99,235,0.5)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 p-4 bg-red-50 border-2 border-red-100 rounded-2xl flex items-start gap-3 text-red-700"
            >
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="text-left">
                <p className="font-bold">Błąd generowania mapy</p>
                <p className="text-sm opacity-90">{error}</p>
              </div>
            </motion.div>
          )}
        </div>

        {/* Sitemap Visualization */}
        <AnimatePresence>
          {data && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-50 border-2 border-slate-200 rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 p-2 rounded-xl">
                    <Globe className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="font-mono text-sm font-bold text-slate-500">{url}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400 uppercase font-bold tracking-widest">
                  <span className="px-3 py-1.5 bg-slate-100 rounded-lg">Scroll: Zoom</span>
                  <span className="px-3 py-1.5 bg-slate-100 rounded-lg">Drag: Pan</span>
                </div>
              </div>
              <div 
                className="relative h-[800px] w-full bg-slate-50 cursor-grab active:cursor-grabbing"
                style={{ overscrollBehavior: 'none' }}
              >
                <svg ref={svgRef} className="w-full h-full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Preview Modal removed as requested */}

      <footer className="mt-16 border-t border-slate-200 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Network className="w-5 h-5 text-slate-300" />
            <span className="font-bold text-slate-900">VisualSitemap</span>
          </div>
          <p className="text-slate-400 text-sm">© 2026 VisualSitemap Generator. Wszelkie prawa zastrzeżone.</p>
        </div>
      </footer>
    </div>
  );
}

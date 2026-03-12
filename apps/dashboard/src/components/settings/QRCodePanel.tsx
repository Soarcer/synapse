// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { apiUrl } from '../../utils/api';

interface LocalUrlResponse {
  ip: string;
  port: number;
  url: string;
  warning?: string;
}

export function QRCodePanel() {
  const [data, setData] = useState<LocalUrlResponse | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);

  // Fetch local URL on mount + on refresh clicks
  // P1: pass dashboardPort so QR points to dashboard, not API server in dev
  useEffect(() => {
    let cancelled = false;
    const dashboardPort = window.location.port;
    const qs = dashboardPort ? `?dashboardPort=${dashboardPort}` : '';
    fetch(apiUrl(`/api/network/local-url${qs}`))
      .then((r) => r.json())
      .then(async (result: LocalUrlResponse) => {
        if (cancelled) return;
        setData(result);
        try {
          const src = await QRCode.toDataURL(result.url, {
            width: 160,
            margin: 2,
            color: { dark: '#e5e7eb', light: '#00000000' },
          });
          if (!cancelled) setQrSrc(src);
        } catch {
          // QR generation failed — show URL only
        }
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  const handleRefresh = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard API unavailable */
    }
  }, [data]);

  return (
    <section>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Open on your phone</h3>
      <div className="flex items-start gap-4">
        {/* QR Code */}
        <div className="flex-shrink-0">
          {qrSrc ? (
            <img src={qrSrc} alt="QR code for local URL" className="w-24 h-24 rounded" />
          ) : (
            <div className="w-24 h-24 bg-gray-800 rounded flex items-center justify-center">
              <span className="text-[10px] text-gray-600">Loading...</span>
            </div>
          )}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 mb-1">
            Scan to open Synapse on any device on your network.
          </p>
          {data && (
            <code className="text-xs text-blue-300 bg-gray-900 px-2 py-1 rounded block truncate">
              {data.url}
            </code>
          )}
          {data?.warning && <p className="text-[10px] text-amber-400 mt-1">{data.warning}</p>}
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleCopyLink}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              aria-label={linkCopied ? 'Copied' : 'Copy link'}
            >
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              onClick={handleRefresh}
              className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Refresh QR"
            >
              Refresh QR
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

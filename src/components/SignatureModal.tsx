'use client';

import { useRef, useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onConfirm: (dataUrl: string) => void;
  onClose: () => void;
}

export default function SignatureModal({ title, onConfirm, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawing(true);
    lastPos.current = getPos(e);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing || !lastPos.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasDrawn(true);
  }

  function stopDraw() {
    setIsDrawing(false);
    lastPos.current = null;
  }

  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function confirm() {
    if (!hasDrawn || !canvasRef.current) return;
    onConfirm(canvasRef.current.toDataURL('image/png'));
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--color-white)', width: '100%', borderTop: '2px solid var(--color-black)', padding: 'var(--space-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-lg)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {title}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={800}
          height={240}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
          style={{
            width: '100%', height: 150,
            border: '2px solid var(--color-black)',
            cursor: 'crosshair', display: 'block',
            touchAction: 'none',
            background: '#fff',
          }}
        />
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray)', marginTop: 6, marginBottom: 'var(--space-md)' }}>
          Sign above with your finger or mouse
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <button onClick={clear} className="btn btn-outline" style={{ flex: 1 }}>CLEAR</button>
          <button onClick={confirm} disabled={!hasDrawn} className="btn btn-primary" style={{ flex: 2 }}>
            CONFIRM SIGNATURE
          </button>
        </div>
      </div>
    </div>
  );
}

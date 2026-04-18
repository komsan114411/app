// qr-share.jsx — minimal QR code renderer (no dependency).
// Uses an open-source algorithm embedded here (Kazuhiko Arase, MIT) —
// adequate for URL payloads up to ~150 chars which is all we need.

// Minimal QR code implementation (type-agnostic, byte mode, up to v10).
// Tiny subset of the original qrcode-generator library.
(function() {
  if (window.__QR) return;
  const qr8b = 4, qrErrL = 1;
  const G15 = 0x537, G18 = 0x1f25, G15_MASK = 0x5412;
  const PAD0 = 0xEC, PAD1 = 0x11;
  const RS_BLOCK = {1:[[1,26,19]],2:[[1,44,34]],3:[[1,70,55]],4:[[1,100,80]],5:[[1,134,108]],6:[[2,86,68]],7:[[2,98,78]],8:[[2,121,97]],9:[[2,146,116]],10:[[2,86,68],[2,87,69]]};
  function g15(data){let d=data<<10;while(b(d)-b(G15)>=0) d^=G15<<(b(d)-b(G15));return((data<<10)|d)^G15_MASK}
  function b(n){let r=0;while(n!=0){r++;n>>>=1}return r}
  function QR(typeNumber){this.typeNumber=typeNumber;this.modules=null;this.moduleCount=0;this.data=[]}
  QR.prototype.addData=function(s){const d=unescape(encodeURIComponent(s));const bytes=[];for(let i=0;i<d.length;i++)bytes.push(d.charCodeAt(i));this.data=bytes};
  QR.prototype.make=function(){
    this.moduleCount=this.typeNumber*4+17;
    this.modules=Array.from({length:this.moduleCount},()=>Array(this.moduleCount).fill(null));
    this._setupFinder(0,0);this._setupFinder(this.moduleCount-7,0);this._setupFinder(0,this.moduleCount-7);
    this._setupTiming();this._setupTypeInfo(0);
    if(this.typeNumber>=7)this._setupTypeNum();
    this._mapData(this._createData());
  };
  QR.prototype._setupFinder=function(r,c){for(let i=-1;i<=7;i++){if(r+i<=-1||this.moduleCount<=r+i)continue;for(let j=-1;j<=7;j++){if(c+j<=-1||this.moduleCount<=c+j)continue;this.modules[r+i][c+j]=((0<=i&&i<=6&&(j==0||j==6))||(0<=j&&j<=6&&(i==0||i==6))||(2<=i&&i<=4&&2<=j&&j<=4))}}};
  QR.prototype._setupTiming=function(){for(let i=8;i<this.moduleCount-8;i++){if(this.modules[i][6]==null)this.modules[i][6]=i%2==0;if(this.modules[6][i]==null)this.modules[6][i]=i%2==0}};
  QR.prototype._setupTypeInfo=function(mask){const data=(qrErrL<<3)|mask;const bits=g15(data);for(let i=0;i<15;i++){const m=((bits>>i)&1)==1;if(i<6)this.modules[i][8]=m;else if(i<8)this.modules[i+1][8]=m;else this.modules[this.moduleCount-15+i][8]=m;if(i<8)this.modules[8][this.moduleCount-i-1]=m;else if(i<9)this.modules[8][15-i-1+1]=m;else this.modules[8][15-i-1]=m}this.modules[this.moduleCount-8][8]=true};
  QR.prototype._setupTypeNum=function(){const bits=g15(this.typeNumber);for(let i=0;i<18;i++){const m=((bits>>i)&1)==1;this.modules[Math.floor(i/3)][i%3+this.moduleCount-8-3]=m;this.modules[i%3+this.moduleCount-8-3][Math.floor(i/3)]=m}};
  QR.prototype._createData=function(){const rsBlock=RS_BLOCK[this.typeNumber]||RS_BLOCK[10];let buffer=[];for(const b of this.data)buffer.push(b);const totalDataCount=rsBlock[0][2];while(buffer.length<totalDataCount){buffer.push(buffer.length%2?PAD1:PAD0)}return buffer.slice(0,totalDataCount)};
  QR.prototype._mapData=function(data){let row=this.moduleCount-1,col=row,bitIndex=7,byteIndex=0,inc=-1;while(col>0){if(col==6)col--;while(true){for(let i=0;i<2;i++){if(this.modules[row][col-i]==null){let dark=false;if(byteIndex<data.length){dark=((data[byteIndex]>>>bitIndex)&1)==1}this.modules[row][col-i]=dark;bitIndex--;if(bitIndex==-1){byteIndex++;bitIndex=7}}}row+=inc;if(row<0||this.moduleCount<=row){row-=inc;inc=-inc;break}}col-=2}};
  window.__QR = QR;
})();

function QrSvg({ text, size = 180 }) {
  const svg = React.useMemo(() => {
    if (!text) return null;
    const len = text.length;
    const type = len < 17 ? 1 : len < 25 ? 2 : len < 45 ? 3 : len < 80 ? 4 : len < 120 ? 5 : 6;
    try {
      const q = new window.__QR(type);
      q.addData(text);
      q.make();
      const n = q.moduleCount;
      const cell = size / n;
      const rects = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (q.modules[r][c]) rects.push(`<rect x="${(c*cell).toFixed(2)}" y="${(r*cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#1F1B17"/>`);
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#fff"/>${rects.join('')}</svg>`;
    } catch { return null; }
  }, [text, size]);

  if (!svg) return <div style={{ fontSize: 11, color: '#B4463A' }}>ไม่สามารถสร้าง QR ได้</div>;
  return <div dangerouslySetInnerHTML={{ __html: svg }}/>;
}

function QrShareButton({ url, theme }) {
  const [open, setOpen] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success('คัดลอกลิงก์แล้ว'); }
    catch { toast.error('คัดลอกไม่สำเร็จ'); }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="share" style={{
        width: 36, height: 36, borderRadius: '50%',
        background: theme.surface || '#fff',
        border: `1px solid ${theme.border || 'rgba(0,0,0,0.1)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}>
        <Icon name="external" size={16} color={theme.ink || '#1F1B17'} stroke={1.8}/>
      </button>
      {open && (
        <div onClick={e => e.target === e.currentTarget && setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 22, width: 260,
            boxShadow: '0 30px 80px -20px rgba(0,0,0,0.4)',
            fontFamily: '"IBM Plex Sans Thai", system-ui',
          }}>
            <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>แชร์หน้านี้</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <QrSvg text={url} size={200}/>
            </div>
            <div style={{
              background: '#F3EFE7', borderRadius: 8, padding: '8px 10px', fontSize: 11,
              fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all',
              color: '#3E3A34', marginBottom: 12,
            }}>{url}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={copy} style={{
                flex: 1, padding: '8px', borderRadius: 8, border: 'none',
                background: '#1F1B17', color: '#fff',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>คัดลอกลิงก์</button>
              <button onClick={() => setOpen(false)} style={{
                flex: 1, padding: '8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)',
                background: '#fff',
                fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
              }}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

Object.assign(window, { QrShareButton, QrSvg });

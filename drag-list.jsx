// drag-list.jsx — lightweight HTML5 drag-reorder wrapper.
// Usage:
//   <DragList items={buttons} onReorder={next => setState({ ...s, buttons: next })}>
//     {(item, i, handleProps) => <div key={item.id}>{handleProps.handle} {item.label}</div>}
//   </DragList>
// `handleProps.handle` is a little drag-grip element that triggers the drag.

function DragList({ items, onReorder, children, itemKey = (it) => it.id }) {
  const [dragIndex, setDragIndex] = React.useState(null);
  const [overIndex, setOverIndex] = React.useState(null);

  const move = (from, to) => {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder?.(next);
  };

  return (
    <div>
      {items.map((item, i) => {
        const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
        const handle = (
          <div
            draggable
            onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
            aria-label="drag-handle"
            title="ลากเพื่อเรียงใหม่"
            style={{
              cursor: 'grab', userSelect: 'none',
              padding: '4px 6px', color: '#8F877C',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="12" height="16" viewBox="0 0 6 10" fill="currentColor">
              <circle cx="1.5" cy="1.5" r="1"/><circle cx="4.5" cy="1.5" r="1"/>
              <circle cx="1.5" cy="5"   r="1"/><circle cx="4.5" cy="5"   r="1"/>
              <circle cx="1.5" cy="8.5" r="1"/><circle cx="4.5" cy="8.5" r="1"/>
            </svg>
          </div>
        );

        return (
          <div
            key={itemKey(item)}
            onDragOver={(e) => { e.preventDefault(); setOverIndex(i); }}
            onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) move(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
            style={{
              position: 'relative',
              borderTop: isOver && dragIndex > i ? '2px solid #1F1B17' : '2px solid transparent',
              borderBottom: isOver && dragIndex < i ? '2px solid #1F1B17' : '2px solid transparent',
              transition: 'border 120ms ease',
              opacity: dragIndex === i ? 0.5 : 1,
            }}
          >
            {children(item, i, { handle })}
          </div>
        );
      })}
    </div>
  );
}

window.DragList = DragList;

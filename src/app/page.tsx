"use client";

import { useEffect, useState, useMemo } from 'react';
import { VirtualDisk, FileSystemAPI, DirEntry, TOTAL_CLUSTERS, FAT_FREE, FAT_EOF } from '../lib/fat8';
import styles from './page.module.css';

export default function Home() {
  const [fs, setFs] = useState<FileSystemAPI | null>(null);
  const [files, setFiles] = useState<DirEntry[]>([]);
  const [fat, setFat] = useState<Uint8Array>(new Uint8Array(256));
  const [trigger, setTrigger] = useState(0);

  const [currentPath, setCurrentPath] = useState<{ name: string, cluster: number }[]>([{ name: 'Root', cluster: 0 }]);
  const currentDirCluster = currentPath[currentPath.length - 1].cluster;

  const [newFileName, setNewFileName] = useState('');
  const [newFileBlocks, setNewFileBlocks] = useState('1');

  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    const disk = new VirtualDisk();
    const fileSystem = new FileSystemAPI(disk);
    fileSystem.format();

    fileSystem.onChange = () => {
      setTrigger(t => t + 1);
    };

    setFs(fileSystem);
  }, []);

  useEffect(() => {
    if (fs) {
      setFiles(fs.listDir(currentDirCluster));
      setFat(new Uint8Array(fs.getFAT()));
    }
  }, [fs, trigger, currentDirCluster]);

  const clusterMap = useMemo(() => {
    if (!fs) return {};

    const map: Record<number, { color: string, borderColor?: string, name: string }> = {};
    let colorIndex = 0;

    const PALETTE = [
      "#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e",
      "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
      "#f43f5e", "#14b8a6", "#8b5cf6", "#d946ef"
    ];

    function traverse(dirCluster: number, parentColor?: string) {
      try {
        if (!fs) return;
        const entries = fs.listDir(dirCluster);
        for (const e of entries) {
          if (e.firstCluster === 0) continue;

          const myColor = PALETTE[colorIndex % PALETTE.length];
          colorIndex++;

          let current = e.firstCluster;
          let visited = new Set<number>();
          while (current !== 0 && current !== FAT_EOF && current >= 6 && current <= 255) {
            if (visited.has(current)) break;
            visited.add(current);

            map[current] = {
              color: myColor,
              borderColor: parentColor,
              name: e.name
            };
            current = fat[current];
          }

          if (e.isDir) {
            traverse(e.firstCluster, myColor);
          }
        }
      } catch (e) { }
    }

    traverse(0);
    return map;
  }, [fs, fat]);

  if (!fs) return <div className={styles.container}>Loading Simulator...</div>;

  const handleCreateFile = () => {
    if (!newFileName.trim()) return;
    try {
      const blocks = parseInt(newFileBlocks) || 1;
      fs.createFile(newFileName, blocks, currentDirCluster);
      setNewFileName('');
      setNewFileBlocks('1');
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    try {
      fs.createFolder(newFolderName, currentDirCluster);
      setNewFolderName('');
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDeleteFile = (filename: string) => {
    try {
      fs.deleteFile(filename, currentDirCluster);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleNavigate = (folder: DirEntry) => {
    if (folder.isDir) {
      setCurrentPath([...currentPath, { name: folder.name, cluster: folder.firstCluster }]);
    }
  };

  const handleGoBack = () => {
    if (currentPath.length > 1) {
      setCurrentPath(currentPath.slice(0, currentPath.length - 1));
    }
  };

  const getCellStyle = (clusterIndex: number) => {
    let baseStyle: any = {};
    if (clusterIndex === 0) return { background: 'var(--accent)', color: 'white' };
    if (clusterIndex === 1) return { background: '#f59e0b', color: 'white' };
    if (clusterIndex >= 2 && clusterIndex <= 5) return { background: '#10b981', color: 'white' };

    if (fat[clusterIndex] !== FAT_FREE) {
      const info = clusterMap[clusterIndex];
      if (info) {
        baseStyle.background = info.color;
        baseStyle.color = 'white';
        if (info.borderColor) {
          baseStyle.border = `2px solid ${info.borderColor}`;
        }
      } else {
        baseStyle.background = 'var(--primary)';
        baseStyle.color = 'white';
      }
    }
    return baseStyle;
  }

  const pathString = currentPath.map(p => p.name).join(' / ');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>FAT8 File System Simulator</h1>
        <p style={{ color: 'var(--text-muted)' }}>A fully functional browser-based simulation demonstrating Sectors, Clusters, and the FAT</p>
      </header>

      <div className={styles.dashboard}>
        <div className={styles.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            <h2 style={{ margin: 0, border: 'none', padding: 0 }}>File Manager</h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', padding: '0.5rem', background: 'var(--bg)', borderRadius: '4px' }}>
            {currentPath.length > 1 && (
              <button onClick={handleGoBack} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer' }}>
                ← Back
              </button>
            )}
            <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{pathString}</span>
          </div>

          <ul className={styles.fileList}>
            {files.length === 0 && <li className={styles.fileItem} style={{ background: 'transparent', padding: '1rem 0' }}>Directory is empty.</li>}
            {files.map(f => {
              const fullName = `${f.name}${f.ext ? '.' + f.ext : ''}`;
              return (
                <li key={f.index} className={styles.fileItem}>
                  <div style={{ flex: 1, cursor: f.isDir ? 'pointer' : 'default' }} onClick={() => handleNavigate(f)}>
                    <strong>{f.isDir ? `📁 ${f.name}` : `📄 ${fullName}`}</strong>
                    {!f.isDir && <span> ({f.fileSize / 256} blocks)</span>}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Start Cluster: {f.firstCluster}</div>
                  </div>
                  <button onClick={() => handleDeleteFile(f.isDir ? f.name : fullName)}>Delete</button>
                </li>
              )
            })}
          </ul>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '2rem' }}>
            <div className={styles.fileForm} style={{ flexDirection: 'column', marginTop: 0 }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--accent)' }}>Allocate New File</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  placeholder="Filename (e.g. data.bin)"
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  placeholder="Blocks"
                  value={newFileBlocks}
                  onChange={e => setNewFileBlocks(e.target.value)}
                  style={{ maxWidth: '100px' }}
                />
              </div>
              <button onClick={handleCreateFile}>Allocate File</button>
            </div>

            <div className={styles.fileForm} style={{ flexDirection: 'column', marginTop: 0 }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--success)' }}>Create New Folder</h3>
              <input
                placeholder="Folder Name"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
              />
              <button onClick={handleCreateFolder} style={{ background: 'var(--success)' }}>Create Folder</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className={styles.panel}>
            <h2>Disk Visualizer (Clusters)</h2>
            <div className={styles.grid}>
              {Array.from({ length: TOTAL_CLUSTERS }).map((_, i) => (
                <div
                  key={`disk-${i}`}
                  className={styles.cell}
                  style={getCellStyle(i)}
                  title={`Cluster ${i} ${clusterMap[i] ? `(${clusterMap[i].name})` : ''}`}
                >
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className={`${styles.cell} ${styles.cellBoot}`} style={{ width: 16, height: 16, border: 'none' }}></div> Boot</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className={`${styles.cell} ${styles.cellFat}`} style={{ width: 16, height: 16, border: 'none' }}></div> FAT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className={`${styles.cell} ${styles.cellRoot}`} style={{ width: 16, height: 16, border: 'none' }}></div> Root Dir</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className={`${styles.cell} ${styles.cellAllocated}`} style={{ width: 16, height: 16, border: 'none' }}></div> File Data</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className={`${styles.cell} ${styles.cellFree}`} style={{ width: 16, height: 16, border: 'none' }}></div> Free</div>
            </div>
          </div>

          <div className={styles.panel}>
            <h2>FAT Table</h2>
            <div className={styles.grid}>
              {Array.from(fat).map((val, i) => {
                let display = val.toString(16).toUpperCase().padStart(2, '0');
                if (val === FAT_FREE) display = "00";
                if (val === FAT_EOF) display = "FF";

                return (
                  <div
                    key={`fat-${i}`}
                    className={styles.cell}
                    style={getCellStyle(i)}
                    title={`Cluster ${i} -> ${val === FAT_EOF ? 'EOF' : val === FAT_FREE ? 'Free' : val} ${clusterMap[i] ? `(${clusterMap[i].name})` : ''}`}
                  >
                    {display}
                  </div>
                )
              })}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '1rem' }}>Values indicate the next cluster in the chain. FF = End of File. 00 = Free.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

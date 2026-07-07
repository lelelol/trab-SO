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

    // Using a more subtle palette to match the dark slate theme, we'll use these as border-colors 
    // or translucent backgrounds. We use Tailwind-ish colors: Indigo, Rose, Teal, Amber, Fuchsia, Cyan.
    const PALETTE = [
      "#6366f1", // Indigo
      "#f43f5e", // Rose
      "#14b8a6", // Teal
      "#f59e0b", // Amber
      "#d946ef", // Fuchsia
      "#06b6d4", // Cyan
      "#8b5cf6", // Violet
      "#10b981", // Emerald
    ];

    function traverse(dirCluster: number, parentColor?: string) {
      try {
        if (!fs) return;
        const entries = fs.listDir(dirCluster);
        for (const e of entries) {
          if (e.firstCluster === 0) continue;
          if (e.name === "." || e.name === "..") continue;

          const myColor = PALETTE[e.firstCluster % PALETTE.length];

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
      if (folder.name === '.') return;
      if (folder.name === '..') {
        handleGoBack();
        return;
      }
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
    if (clusterIndex === 0) return { background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderColor: 'rgba(139, 92, 246, 0.3)' }; // Boot
    if (clusterIndex === 1) return { background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', borderColor: 'rgba(245, 158, 11, 0.3)' }; // FAT
    if (clusterIndex >= 2 && clusterIndex <= 5) return { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }; // Root

    if (fat[clusterIndex] !== FAT_FREE) {
      const info = clusterMap[clusterIndex];
      if (info) {
        baseStyle.background = info.color;
        baseStyle.color = 'white';
        baseStyle.borderColor = info.borderColor || info.color;
        if (info.borderColor) {
          baseStyle.borderWidth = '2px';
        }
      } else {
        baseStyle.background = 'var(--primary)';
        baseStyle.color = 'white';
        baseStyle.borderColor = 'var(--border)';
      }
    }
    return baseStyle;
  }

  const pathString = currentPath.map(p => p.name).join(' / ');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Simulador FAT</h1>
      </header>

      <div className={styles.dashboard}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>File Manager</h2>
          </div>

          <div className={styles.toolbar}>
            {currentPath.length > 1 && (
              <button onClick={handleGoBack} className={styles.btnBack}>
                Voltar
              </button>
            )}
            <span className={styles.pathString}><strong>Path:</strong> {pathString}</span>
          </div>

          <ul className={styles.fileList}>
            {files.length === 0 && <li className={styles.fileItem} style={{ border: 'none', background: 'transparent' }}>Directory is empty.</li>}
            {files.map(f => {
              const fullName = `${f.name}${f.ext ? '.' + f.ext : ''}`;
              return (
                <li key={f.index} className={styles.fileItem}>
                  <div className={styles.fileInfo} onClick={() => handleNavigate(f)}>
                    <span className={styles.fileName}>
                      {f.isDir ? `[DIR]` : `[FILE]`} {f.isDir ? f.name : fullName}
                    </span>
                    <div className={styles.fileMeta}>
                      {!f.isDir && <span>{f.fileSize / 256} blocks</span>}
                      <span>Cluster: {f.firstCluster}</span>
                    </div>
                  </div>
                  <button className={styles.btnDelete} onClick={() => handleDeleteFile(f.isDir ? f.name : fullName)}>
                    Excluir
                  </button>
                </li>
              )
            })}
          </ul>

          <div className={styles.formGroup}>
            <h3>Allocate New File</h3>
            <div className={styles.inputRow}>
              <input
                className={`${styles.input} ${styles.inputFlex}`}
                placeholder="Filename (e.g. data.bin)"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
              />
              <input
                type="number"
                min="1"
                className={`${styles.input} ${styles.inputSmall}`}
                placeholder="Blocks"
                value={newFileBlocks}
                onChange={e => setNewFileBlocks(e.target.value)}
              />
            </div>
            <button className={styles.btnPrimary} onClick={handleCreateFile}>Allocate File</button>
          </div>

          <div className={styles.formGroup}>
            <h3>Create New Folder</h3>
            <div className={styles.inputRow}>
              <input
                className={`${styles.input} ${styles.inputFlex}`}
                placeholder="Folder Name"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
              />
              <button className={`${styles.btnPrimary} ${styles.btnSuccess}`} onClick={handleCreateFolder}>Create Folder</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Disk Visualizer (Clusters)</h2>
            </div>
            <div className={styles.grid}>
              {Array.from({ length: TOTAL_CLUSTERS }).map((_, i) => (
                <div
                  key={`disk-${i}`}
                  className={`${styles.cell} ${fat[i] === FAT_FREE ? styles.cellFree : ''}`}
                  style={getCellStyle(i)}
                  title={`Cluster ${i} ${clusterMap[i] ? `(${clusterMap[i].name})` : ''}`}
                >
                </div>
              ))}
            </div>
            
            <div className={styles.legend}>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellBoot}`}></div> Boot</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellFat}`}></div> FAT</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellRoot}`}></div> Root Dir</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellAllocated}`}></div> File Data</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellFree}`}></div> Free</div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>FAT Table</h2>
            </div>
            <div className={styles.grid}>
              {Array.from(fat).map((val, i) => {
                let display = val.toString(16).toUpperCase().padStart(2, '0');
                if (val === FAT_FREE) display = "00";
                if (val === FAT_EOF) display = "FF";

                return (
                  <div
                    key={`fat-${i}`}
                    className={`${styles.cell} ${fat[i] === FAT_FREE ? styles.cellFree : ''}`}
                    style={getCellStyle(i)}
                    title={`Cluster ${i} -> ${val === FAT_EOF ? 'EOF' : val === FAT_FREE ? 'Free' : val} ${clusterMap[i] ? `(${clusterMap[i].name})` : ''}`}
                  >
                    {display}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

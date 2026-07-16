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

    // Paleta expandida com cores bem distintas para garantir alto contraste visual entre os blocos alocados
    const PALETTE = [
      "#ef4444", // Red
      "#f97316", // Orange
      "#eab308", // Yellow
      "#84cc16", // Lime
      "#10b981", // Emerald
      "#14b8a6", // Teal
      "#06b6d4", // Cyan
      "#0ea5e9", // Sky
      "#3b82f6", // Blue
      "#6366f1", // Indigo
      "#8b5cf6", // Violet
      "#a855f7", // Purple
      "#d946ef", // Fuchsia
      "#ec4899", // Pink
      "#f43f5e", // Rose
      "#fb923c", // Orange Light
      "#4ade80", // Green Light
      "#2dd4bf", // Teal Light
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

  if (!fs) return <div className={styles.container}>Carregando Simulador...</div>;

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

  const getContrastColor = (hex?: string) => {
    if (!hex) return 'white';
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substr(0, 2), 16);
    const g = parseInt(cleanHex.substr(2, 4), 16);
    const b = parseInt(cleanHex.substr(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#09090b' : '#ffffff'; // Dark text for bright backgrounds
  };

  const pathString = currentPath.map(p => p.name).join(' / ');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Simulador FAT</h1>
      </header>

      <div className={styles.dashboard}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Gerenciador de Arquivos</h2>
          </div>

          <div className={styles.toolbar}>
            {currentPath.length > 1 && (
              <button onClick={handleGoBack} className={styles.btnBack}>
                Voltar
              </button>
            )}
            <span className={styles.pathString}><strong>Caminho:</strong> {pathString}</span>
          </div>

          <ul className={styles.fileList}>
            {files.length === 0 && <li className={styles.fileItem} style={{ border: 'none', background: 'transparent' }}>Diretório vazio.</li>}
            {files.map(f => {
              const fullName = `${f.name}${f.ext ? '.' + f.ext : ''}`;
              const fileColor = clusterMap[f.firstCluster]?.color;
              const textColor = getContrastColor(fileColor);
              const isDarkText = textColor === '#09090b';
              
              return (
                <li 
                  key={f.index} 
                  className={styles.fileItem}
                  style={fileColor ? { 
                    background: fileColor,
                    color: textColor,
                    border: `1px solid ${fileColor}`
                  } : {}}
                >
                  <div className={styles.fileInfo} onClick={() => handleNavigate(f)}>
                    <span className={styles.fileName}>
                      {f.isDir ? `[PASTA]` : `[ARQ]`} {f.isDir ? f.name : fullName}
                    </span>
                    <div className={styles.fileMeta} style={fileColor ? { color: isDarkText ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.8)' } : {}}>
                      {!f.isDir && <span>{f.fileSize / 256} blocos</span>}
                      <span>Cluster: {f.firstCluster}</span>
                    </div>
                  </div>
                  <button 
                    className={styles.btnDelete} 
                    style={fileColor ? { 
                      color: textColor, 
                      borderColor: isDarkText ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.4)' 
                    } : {}}
                    onClick={() => handleDeleteFile(f.isDir ? f.name : fullName)}
                  >
                    Excluir
                  </button>
                </li>
              )
            })}
          </ul>

          <div className={styles.formGroup}>
            <h3>Alocar Novo Arquivo</h3>
            <div className={styles.inputRow}>
              <input
                className={`${styles.input} ${styles.inputFlex}`}
                placeholder="Nome do arquivo (ex: dados.bin)"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
              />
              <input
                type="number"
                min="1"
                className={`${styles.input} ${styles.inputSmall}`}
                placeholder="Blocos"
                value={newFileBlocks}
                onChange={e => setNewFileBlocks(e.target.value)}
              />
            </div>
            <button className={styles.btnPrimary} onClick={handleCreateFile}>Alocar Arquivo</button>
          </div>

          <div className={styles.formGroup}>
            <h3>Criar Nova Pasta</h3>
            <div className={styles.inputRow}>
              <input
                className={`${styles.input} ${styles.inputFlex}`}
                placeholder="Nome da pasta"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
              />
              <button className={`${styles.btnPrimary} ${styles.btnSuccess}`} onClick={handleCreateFolder}>Criar Pasta</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Visualizador de Disco (Clusters)</h2>
            </div>
            <div className={styles.grid}>
              {Array.from({ length: TOTAL_CLUSTERS }).map((_, i) => {
                const nextCluster = fat[i];
                let nextStr = nextCluster.toString();
                if (nextCluster === FAT_EOF) nextStr = "EOF";
                else if (nextCluster === FAT_FREE) nextStr = "Livre";

                return (
                  <div
                    key={`disk-${i}`}
                    className={`${styles.cell} ${fat[i] === FAT_FREE ? styles.cellFree : ''}`}
                    style={getCellStyle(i)}
                    title={`Cluster ${i} -> Próximo: ${nextStr} ${clusterMap[i] ? `(${clusterMap[i].name})` : ''}`}
                  >
                    {i}
                  </div>
                );
              })}
            </div>
            
            <div className={styles.legend}>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellBoot}`}></div> Boot</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellFat}`}></div> FAT</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellRoot}`}></div> Dir. Raiz</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellAllocated}`}></div> Dados</div>
              <div className={styles.legendItem}><div className={`${styles.legendColor} ${styles.cellFree}`}></div> Livre</div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Tabela FAT</h2>
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
                    title={`Cluster ${i} -> ${val === FAT_EOF ? 'EOF' : val === FAT_FREE ? 'Livre' : val} ${clusterMap[i] ? `(${clusterMap[i].name})` : ''}`}
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

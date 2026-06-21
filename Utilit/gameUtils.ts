type TileInfo = {
  x: number;
  y: number;
  img?: Phaser.GameObjects.Image;
  id?: number;
};

// интерфейс сцены, чтобы хранить group/доступ к добавлениям
type HexScene = Phaser.Scene & {
  hexGroup?: Phaser.GameObjects.Group;
  add: Phaser.GameObjects.GameObjectFactory;
  time: Phaser.Time.Clock;
  textures: Phaser.Textures.TextureManager;
};

export function addRandomTextures(
  scale: number,
  HexArr: number[][],
  topIdx: number,
  botIdx: number
): string {
  const textures = ['Forest', 'Stone', 'StoneForest'];
  const TextureCount = 3;

  // индексы верхней и нижней части
  const topIndices: number[] = [];
  for (let i = 0; i < Math.round(HexArr[0].length / 2) - 1; i++) topIndices.push(i);

  const botIndices: number[] = [];
  for (let i = Math.round(HexArr[0].length / 2) + 1; i < HexArr[0].length; i++) botIndices.push(i);

  const occupied = new Set<number>([topIdx, botIdx]);

  // Функция выбора случайных неповторяющихся индексов
  function getRandomIndices(parts: number[], max: number): number[] {
    const free = parts.filter((i) => !occupied.has(i));
    if (free.length == 0) return [];
    const count = Math.min(max, free.length);

    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = free[i];
      free[i] = free[j];
      free[j] = tmp;
    }

    return free.slice(0, count);
  }

  const topPicks = getRandomIndices(topIndices, TextureCount);
  const botPicks = getRandomIndices(botIndices, TextureCount);
  const allResourse: Array<{ cell: number; textures: string }> = [];

  topPicks.forEach((idx) => {
    occupied.add(idx);
    allResourse.push({
      cell: idx,
      textures: textures[Math.floor(Math.random() * textures.length)]
    });
  });

  botPicks.forEach((idx) => {
    occupied.add(idx);
    allResourse.push({
      cell: idx,
      textures: textures[Math.floor(Math.random() * textures.length)]
    });
  });

  return JSON.stringify(allResourse);
}

// Создание адаптивного шестиугольного поля боя
export function setHexPlace(
  this: HexScene,
  startX: number,
  maxX: number,
  startY: number,
  maxY: number,
  scale = 1
): [TileInfo[], number, number] {
  const scene = this;
  if (!scene || !scene.textures) {
    console.error('Неправильный контекст сцены');
    return [[], 0, 0];
  }
  if (!scene.textures.exists('place')) {
    console.error('Текстура place не найдена');
    return [[], 0, 0];
  }

  const availableWidth = maxX - startX;
  const availableHeight = maxY - startY;
  
  const cols = 2;  // Количество столбцов
  const rows = 4;  // Количество строк
  const maxTileWidth = Math.floor(screen.availWidth / (cols * (screen.availWidth/220 ) ));
  const maxTileHeight = Math.floor(screen.availHeight / (rows * (screen.availHeight/1000 )+ 0.25));

  const textureSource = scene.textures.get('place').getSourceImage();
  const realWidth = textureSource.width;
  const realHeight = textureSource.height;
  const baseRatio = realWidth / realHeight;
  
  let tileW, tileH;
  if (maxTileWidth / maxTileHeight > baseRatio) {
    tileH = maxTileHeight;
    tileW = Math.floor(tileH * baseRatio);
  } else {
    tileW = maxTileWidth;
    tileH = Math.floor(tileW / baseRatio);
  }
  
  tileW *= scale;
  tileH *= scale;
  
  const minSize = 30 * scale;
  tileW = Math.max(tileW, minSize);
  tileH = Math.max(tileH, Math.floor(minSize / baseRatio));
  
  const horizStep = tileW * 0.98; 
  const vertDist = tileH * 0.75;

  tileW = Math.max(tileW, minSize);
  tileH = Math.max(tileH, minSize * (100/85));

  if (!scene.hexGroup) scene.hexGroup = scene.add.group();
  scene.hexGroup.clear(true, true);

  const tilesCoords: TileInfo[] = [];
  let id = 0;
  
  // Центрируем сетку в доступном пространстве
  const totalWidth = (cols * horizStep) + (tileW * 0.134);
  const totalHeight = (rows * vertDist) + (tileH * 0.25);
  
  const offsetX = startX + (availableWidth - totalWidth) / 2;
  const offsetY = startY + (availableHeight - totalHeight) / 2;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = offsetX + c * horizStep + (r % 2 ? horizStep / 2 : 0);
      const y = offsetY + r * vertDist;
      
     
      const img = scene
        .add.image(x, y, 'place')
        .setDisplaySize(tileW * 1.02, tileH * 1.02)
        .setOrigin(0.5, 0.5)
        .setDepth(10 + r);

      tilesCoords.push({ x, y, img, id });
      id++;
      scene.hexGroup.add(img);
    }
  }
  
  SetBorder(scene, tileW, tileH, tilesCoords, 1);
  return [tilesCoords, cols, rows];
}

// Контур шаблона 6-угольника
export function SetBorder(
  scene: HexScene,
  tileW: number,
  tileH: number,
  tilesCoords: TileInfo[],
  Depth: number
): void {
  const borderW = tileW * 1.12;
  const borderH = tileH;
  const borderColor = 0x000000;
  const borderWidth = 2;
  
  function hexPointsPointy(cx: number, cy: number, w: number, h: number) {
    const rx = w / 2;
    const ry = h / 2;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const angleDeg = 90 + 60 * i;
      const angle = Phaser.Math.DegToRad(angleDeg);
      const px = cx + rx * Math.cos(angle);
      const py = cy + ry * Math.sin(angle);
      pts.push({ x: px, y: py });
    }
    return pts;
  }

  const g = scene.add.graphics();
  g.lineStyle(borderWidth, borderColor, 0.5);
  const pts = hexPointsPointy(borderW / 2, borderH / 2, borderW, borderH);
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.strokePath();

  const texKey = 'hexBorderPointy';
  g.generateTexture(texKey, borderW, borderH);
  g.destroy();

  tilesCoords.forEach((t) => {
    const border = scene
      .add.image(t.x, t.y, texKey)
      .setDisplaySize(borderW, borderH)
      .setOrigin(0.5, 0.5);
    border.setInteractive();
    border.on('pointerdown', () => {
      border.setTint(0xffff00);
      scene.time.delayedCall(150, () => border.clearTint());
    });
    border.setDepth(Depth);
  });
}
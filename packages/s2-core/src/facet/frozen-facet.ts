import { Group, Rect, type LineStyleProps } from '@antv/g';
import { last } from 'lodash';
import type { DataCell } from '../cell';
import {
  FRONT_GROUND_GROUP_FROZEN_Z_INDEX,
  FrozenGroupType,
  FrozenGroupPosition,
  KEY_GROUP_FROZEN_SPLIT_LINE,
  PANEL_GROUP_FROZEN_GROUP_Z_INDEX,
  S2Event,
  SPLIT_LINE_WIDTH,
  FrozenGroupPositionTypeMaps,
} from '../common/constant';
import type { SimpleBBox } from '../engine';
import { FrozenGroup } from '../group/frozen-group';
import { getValidFrozenOptions, renderLine } from '../utils';
import {
  getColsForGrid,
  getFrozenRowsForGrid,
  getRowsForGrid,
} from '../utils/grid';
import type { Indexes, PanelIndexes } from '../utils/indexes';
import { floor } from '../utils/math';
import type {
  FrozenGroupPositions,
  FrozenGroups,
} from '../common/interface/frozen';
import { BaseFacet } from './base-facet';
import { Frame } from './header/frame';
import { Node } from './layout/node';
import {
  calculateFrozenCornerCells,
  calculateInViewIndexes,
  getFrozenGroupTypeByCell,
  getFrozenLeafNodesCount,
  splitInViewIndexesWithFrozen,
  translateGroup,
} from './utils';

/**
 * Defines the row freeze  abstract standard interface
 */
export abstract class FrozenFacet extends BaseFacet {
  public rowOffsets: number[];

  public frozenGroups: FrozenGroups;

  public frozenGroupPositions = {
    [FrozenGroupPosition.Col]: {
      width: 0,
      x: 0,
      range: [] as number[],
    },
    [FrozenGroupPosition.TrailingCol]: {
      width: 0,
      x: 0,
      range: [] as number[],
    },
    [FrozenGroupPosition.Row]: {
      height: 0,
      y: 0,
      range: [] as number[],
    },
    [FrozenGroupPosition.TrailingRow]: {
      height: 0,
      y: 0,
      range: [] as number[],
    },
  } satisfies FrozenGroupPositions;

  public panelScrollGroupIndexes: Indexes = [0, 0, 0, 0];

  protected override initPanelGroups(): void {
    super.initPanelGroups();

    this.frozenGroups = [
      FrozenGroupType.Row,
      FrozenGroupType.Col,
      FrozenGroupType.TrailingRow,
      FrozenGroupType.TrailingCol,
      FrozenGroupType.Top,
      FrozenGroupType.Bottom,
    ].reduce((acc, name) => {
      const frozenGroup = new FrozenGroup({
        name,
        zIndex: PANEL_GROUP_FROZEN_GROUP_Z_INDEX,
        s2: this.spreadsheet,
      });

      this.panelGroup.appendChild(frozenGroup);
      acc[name] = frozenGroup;

      return acc;
    }, {} as FrozenGroups);
  }

  protected getFrozenOptions() {
    const colLength = this.getColLeafNodes().length;
    const cellRange = this.getCellRange();

    return getValidFrozenOptions(
      this.spreadsheet.options.frozen!,
      colLength,
      cellRange.end - cellRange.start + 1,
    );
  }

  public calculateFrozenGroupInfo() {
    const {
      colCount = 0,
      rowCount = 0,
      trailingColCount = 0,
      trailingRowCount = 0,
    } = this.getFrozenOptions();

    const topLevelColNodes = this.getTopLevelColNodes();
    const viewCellHeights = this.viewCellHeights;
    const cellRange = this.getCellRange();
    const { frozenCol, frozenTrailingCol, frozenRow, frozenTrailingRow } =
      this.frozenGroupPositions;

    if (colCount > 0) {
      frozenCol.width =
        topLevelColNodes[colCount - 1].x + topLevelColNodes[colCount - 1].width;
      frozenCol.x = 0;
      frozenCol.range = [0, colCount - 1];
    }

    if (rowCount > 0) {
      frozenRow.height =
        viewCellHeights.getCellOffsetY(cellRange.start + rowCount) -
        viewCellHeights.getCellOffsetY(cellRange.start);
      frozenRow.y = 0;
      frozenRow.range = [cellRange.start, cellRange.start + rowCount - 1];
    }

    if (trailingColCount > 0) {
      frozenTrailingCol.width =
        topLevelColNodes[topLevelColNodes.length - 1].x -
        topLevelColNodes[topLevelColNodes.length - trailingColCount].x +
        topLevelColNodes[topLevelColNodes.length - 1].width;
      frozenTrailingCol.x = this.panelBBox.width - frozenTrailingCol.width;
      frozenTrailingCol.range = [
        topLevelColNodes.length - trailingColCount,
        topLevelColNodes.length - 1,
      ];
    }

    if (trailingRowCount > 0) {
      frozenTrailingRow.height =
        viewCellHeights.getCellOffsetY(cellRange.end + 1) -
        viewCellHeights.getCellOffsetY(cellRange.end + 1 - trailingRowCount);
      frozenTrailingRow.y = this.panelBBox.height - frozenTrailingRow.height;
      frozenTrailingRow.range = [
        cellRange.end - trailingRowCount + 1,
        cellRange.end,
      ];
    }
  }

  protected getFinalViewport() {
    const { viewportHeight: height, viewportWidth: width } = this.panelBBox;

    const {
      colCount = 0,
      rowCount = 0,
      trailingColCount = 0,
      trailingRowCount = 0,
    } = this.getFrozenOptions();

    const finalViewport: SimpleBBox = {
      width,
      height,
      x: 0,
      y: 0,
    };

    if (colCount > 0 || trailingColCount > 0) {
      const { frozenTrailingCol, frozenCol } = this.frozenGroupPositions;

      finalViewport.width -= frozenTrailingCol.width! + frozenCol.width!;
      finalViewport.x += frozenCol.width!;
    }

    if (rowCount > 0 || trailingRowCount > 0) {
      const { frozenRow, frozenTrailingRow } = this.frozenGroupPositions;

      // canvas 高度小于 row height 和 trailingRow height 的时候 height 为 0
      if (
        finalViewport.height <
        frozenRow.height! + frozenTrailingRow.height!
      ) {
        finalViewport.height = 0;
        finalViewport.y = 0;
      } else {
        finalViewport.height -= frozenRow.height! + frozenTrailingRow.height!;
        finalViewport.y += frozenRow.height!;
      }
    }

    return finalViewport;
  }

  public calculateXYIndexes(scrollX: number, scrollY: number): PanelIndexes {
    const colLength = this.getColLeafNodes().length;
    const cellRange = this.getCellRange();

    const {
      colCount = 0,
      rowCount = 0,
      trailingColCount = 0,
      trailingRowCount = 0,
    } = this.getFrozenOptions();

    const finalViewport: SimpleBBox = this.getFinalViewport();

    const indexes =
      this.spreadsheet.isTableMode() && this.spreadsheet.dataSet?.isEmpty?.()
        ? this.spreadsheet.dataSet.getEmptyViewIndexes()
        : calculateInViewIndexes({
            scrollX,
            scrollY,
            widths: this.viewCellWidths,
            heights: this.viewCellHeights,
            viewport: finalViewport,
            rowRemainWidth: this.getRealScrollX(this.cornerBBox.width),
          });

    this.panelScrollGroupIndexes = indexes;

    const { colCount: realColCount, trailingColCount: realTrailingColCount } =
      this.getRealFrozenColumns(colCount, trailingColCount);

    return splitInViewIndexesWithFrozen(
      indexes,
      {
        colCount: realColCount,
        trailingColCount: realTrailingColCount,
        rowCount,
        trailingRowCount,
      },
      colLength,
      cellRange,
    );
  }

  addDataCell = (cell: DataCell) => {
    const {
      rowCount = 0,
      colCount = 0,
      trailingRowCount = 0,
      trailingColCount = 0,
    } = this.getFrozenOptions();

    const colLength = this.getColNodes().length;
    const cellRange = this.getCellRange();
    const { colCount: realColCount, trailingColCount: realTrailingColCount } =
      this.getRealFrozenColumns(colCount, trailingColCount);

    const frozenGroupType = getFrozenGroupTypeByCell(
      cell.getMeta(),
      {
        rowCount,
        trailingRowCount,
        colCount: realColCount,
        trailingColCount: realTrailingColCount,
      },
      colLength,
      cellRange,
    );

    if (frozenGroupType === FrozenGroupType.Scroll) {
      this.panelScrollGroup.appendChild(cell);
    } else {
      this.frozenGroups[frozenGroupType].appendChild(cell);
    }

    setTimeout(() => {
      this.spreadsheet.emit(S2Event.DATA_CELL_RENDER, cell);
      this.spreadsheet.emit(S2Event.LAYOUT_CELL_RENDER, cell);
    }, 100);
  };

  addFrozenCell = (colIndex: number, rowIndex: number, group: Group) => {
    const viewMeta = this.getCellMeta(rowIndex, colIndex);

    if (viewMeta) {
      viewMeta.isFrozenCorner = true;
      const cell = this.spreadsheet.options.dataCell?.(viewMeta)!;

      group.appendChild(cell);
    }
  };

  protected updateFrozenGroupGrid(): void {
    [
      FrozenGroupPosition.Col,
      FrozenGroupPosition.Row,
      FrozenGroupPosition.TrailingCol,
      FrozenGroupPosition.TrailingRow,
    ].forEach((key) => {
      if (!this.frozenGroupPositions[key].range) {
        return;
      }

      let cols: number[] = [];
      let rows: number[] = [];

      if (key.toLowerCase().includes('row')) {
        const [rowMin, rowMax] = this.frozenGroupPositions[key].range || [];

        cols = this.gridInfo.cols;
        rows = getRowsForGrid(rowMin, rowMax, this.viewCellHeights);

        if (key === FrozenGroupPosition.TrailingRow) {
          const top =
            this.frozenGroupPositions[FrozenGroupPosition.TrailingRow].y;

          rows = getFrozenRowsForGrid(
            rowMin,
            rowMax,
            top,
            this.viewCellHeights,
          );
        }
      } else {
        const [colMin, colMax] = this.frozenGroupPositions[key].range || [];
        const nodes = this.getTopLevelColNodes();

        cols = getColsForGrid(colMin, colMax, nodes);
        rows = this.gridInfo.rows;
      }

      const frozenGroup = FrozenGroupPositionTypeMaps[key];

      this.frozenGroups[frozenGroup].updateGrid(
        {
          cols,
          rows,
        },
        frozenGroup,
      );
    });
  }

  public updatePanelScrollGroup(): void {
    super.updatePanelScrollGroup();
    this.updateFrozenGroupGrid();
  }

  protected translateRelatedGroups(
    scrollX: number,
    scrollY: number,
    hRowScroll: number,
  ) {
    super.translateRelatedGroups(scrollX, scrollY, hRowScroll);
    this.translateFrozenGroups();
    this.updateRowResizeArea();
    this.renderFrozenGroupSplitLine(scrollX, scrollY);
  }

  protected translateFrozenGroups = () => {
    const { scrollY, scrollX } = this.getScrollOffset();
    const paginationScrollY = this.getPaginationScrollY();

    const { x, y } = this.panelBBox;

    translateGroup(
      this.frozenGroups[FrozenGroupType.Top],
      x,
      y - paginationScrollY,
    );
    translateGroup(this.frozenGroups[FrozenGroupType.Bottom], x, y);

    translateGroup(
      this.frozenGroups[FrozenGroupType.Row],
      x - scrollX,
      y - paginationScrollY,
    );
    translateGroup(
      this.frozenGroups[FrozenGroupType.TrailingRow],
      x - scrollX,
      y,
    );

    translateGroup(
      this.frozenGroups[FrozenGroupType.Col],
      x,
      y - scrollY - paginationScrollY,
    );
    translateGroup(
      this.frozenGroups[FrozenGroupType.TrailingCol],
      x,
      y - scrollY - paginationScrollY,
    );
  };

  protected updateRowResizeArea() {}

  // eslint-disable-next-line max-lines-per-function
  protected renderFrozenGroupSplitLine = (scrollX: number, scrollY: number) => {
    const {
      width: panelWidth,
      height: panelHeight,
      viewportWidth,
      viewportHeight,
      x: panelBBoxStartX,
      y: panelBBoxStartY,
    } = this.panelBBox;

    const topLevelColNodes = this.getTopLevelColNodes();
    const cellRange = this.getCellRange();
    const {
      rowCount: frozenRowCount = 0,
      colCount: frozenColCount = 0,
      trailingColCount: frozenTrailingColCount = 0,
      trailingRowCount: frozenTrailingRowCount = 0,
    } = this.getFrozenOptions();

    // 在分页条件下需要额外处理 Y 轴滚动值
    const relativeScrollY = Math.floor(scrollY - this.getPaginationScrollY());

    // scroll boundary
    const maxScrollX = Math.max(0, last(this.viewCellWidths)! - viewportWidth);
    const maxScrollY = Math.max(
      0,
      this.viewCellHeights.getCellOffsetY(cellRange.end + 1) -
        this.viewCellHeights.getCellOffsetY(cellRange.start) -
        viewportHeight,
    );

    // remove previous split line group
    this.foregroundGroup.getElementById(KEY_GROUP_FROZEN_SPLIT_LINE)?.remove();

    const { splitLine } = this.spreadsheet.theme;
    const splitLineGroup = this.foregroundGroup.appendChild(
      new Group({
        id: KEY_GROUP_FROZEN_SPLIT_LINE,
        style: {
          zIndex: FRONT_GROUND_GROUP_FROZEN_Z_INDEX,
        },
      }),
    );

    const verticalBorderStyle: Partial<LineStyleProps> = {
      lineWidth: SPLIT_LINE_WIDTH,
      stroke: splitLine?.verticalBorderColor,
      opacity: splitLine?.verticalBorderColorOpacity,
    };

    const horizontalBorderStyle: Partial<LineStyleProps> = {
      lineWidth: SPLIT_LINE_WIDTH,
      stroke: splitLine?.horizontalBorderColor,
      opacity: splitLine?.horizontalBorderColorOpacity,
    };

    const frameVerticalBorderWidth = Frame.getVerticalBorderWidth(
      this.spreadsheet,
    );

    if (frozenColCount > 0) {
      const x = topLevelColNodes.reduce((prev, item, idx) => {
        if (idx < frozenColCount) {
          return prev + item.width;
        }

        return prev;
      }, 0);

      const height =
        (frozenTrailingRowCount > 0 ? panelHeight : viewportHeight) +
        panelBBoxStartY;

      renderLine(splitLineGroup, {
        ...verticalBorderStyle,
        x1: x + panelBBoxStartX,
        x2: x + panelBBoxStartX,
        y1: 0,
        y2: height,
      });

      if (splitLine?.showShadow && scrollX > 0) {
        splitLineGroup.appendChild(
          new Rect({
            style: {
              x: x + panelBBoxStartX,
              y: 0,
              width: splitLine?.shadowWidth!,
              height,
              fill: this.getShadowFill(0),
            },
          }),
        );
      }
    }

    if (frozenRowCount > 0) {
      const y =
        panelBBoxStartY +
        this.getTotalHeightForRange(
          cellRange.start,
          cellRange.start + frozenRowCount - 1,
        );
      const width = frozenTrailingColCount > 0 ? panelWidth : viewportWidth;

      renderLine(splitLineGroup, {
        ...horizontalBorderStyle,
        x1: 0,
        x2: width + frameVerticalBorderWidth,
        y1: y,
        y2: y,
      });

      if (splitLine?.showShadow && relativeScrollY > 0) {
        splitLineGroup.appendChild(
          new Rect({
            style: {
              x: 0,
              y,
              width: width + frameVerticalBorderWidth,
              height: splitLine?.shadowWidth!,
              fill: this.getShadowFill(90),
            },
          }),
        );
      }
    }

    if (frozenTrailingColCount > 0) {
      const { x } =
        topLevelColNodes[topLevelColNodes.length - frozenTrailingColCount];
      const height =
        (frozenTrailingRowCount ? panelHeight : viewportHeight) +
        panelBBoxStartY;

      renderLine(splitLineGroup, {
        ...verticalBorderStyle,
        x1: x + panelBBoxStartX,
        x2: x + panelBBoxStartX,
        y1: 0,
        y2: height,
      });

      if (splitLine?.showShadow && floor(scrollX) < floor(maxScrollX)) {
        splitLineGroup.appendChild(
          new Rect({
            style: {
              x: x + panelBBoxStartX - splitLine.shadowWidth!,
              y: 0,
              width: splitLine.shadowWidth!,
              height,
              fill: this.getShadowFill(180),
            },
          }),
        );
      }
    }

    if (frozenTrailingRowCount > 0) {
      const y =
        this.panelBBox.maxY -
        this.getTotalHeightForRange(
          cellRange.end - frozenTrailingRowCount + 1,
          cellRange.end,
        );
      const width = frozenTrailingColCount > 0 ? panelWidth : viewportWidth;

      renderLine(splitLineGroup, {
        ...horizontalBorderStyle,
        x1: 0,
        x2: width + frameVerticalBorderWidth,
        y1: y,
        y2: y,
      });

      if (splitLine?.showShadow && relativeScrollY < floor(maxScrollY)) {
        splitLineGroup.appendChild(
          new Rect({
            style: {
              x: 0,
              y: y - splitLine.shadowWidth!,
              width: width + frameVerticalBorderWidth,
              height: splitLine.shadowWidth!,
              fill: this.getShadowFill(270),
            },
          }),
        );
      }
    }
  };

  public render(): void {
    this.calculateFrozenGroupInfo();
    this.renderFrozenPanelCornerGroup();
    super.render();
  }

  protected override getCenterFrameScrollX(scrollX: number): number {
    if (this.getFrozenOptions().colCount! > 0) {
      return 0;
    }

    return super.getCenterFrameScrollX(scrollX);
  }

  protected renderFrozenPanelCornerGroup = () => {
    const topLevelNodes = this.getTopLevelColNodes();
    const cellRange = this.getCellRange();

    const {
      rowCount: frozenRowCount = 0,
      colCount: frozenColCount = 0,
      trailingRowCount: frozenTrailingRowCount = 0,
      trailingColCount: frozenTrailingColCount = 0,
    } = this.getFrozenOptions();

    const { colCount, trailingColCount } = getFrozenLeafNodesCount(
      topLevelNodes,
      frozenColCount,
      frozenTrailingColCount,
    );

    const result = calculateFrozenCornerCells(
      {
        rowCount: frozenRowCount,
        colCount,
        trailingRowCount: frozenTrailingRowCount,
        trailingColCount,
      },
      this.getColLeafNodes().length,
      cellRange,
    );

    (Object.keys(result) as (keyof typeof result)[]).forEach((key) => {
      const cells = result[key];
      const group = this.frozenGroups[key];

      if (group) {
        cells.forEach((cell) => {
          this.addFrozenCell(cell.x, cell.y, group);
        });
      }
    });
  };

  getRealFrozenColumns = (
    colCount: number,
    trailingColCount: number,
  ): { colCount: number; trailingColCount: number } => {
    if (colCount || trailingColCount) {
      const nodes = this.getTopLevelColNodes();

      return getFrozenLeafNodesCount(nodes, colCount, trailingColCount);
    }

    return {
      colCount,
      trailingColCount,
    };
  };

  public getTotalHeightForRange = (start: number, end: number) => {
    if (start < 0 || end < 0) {
      return 0;
    }

    if (this.rowOffsets) {
      return this.rowOffsets[end + 1] - this.rowOffsets[start];
    }

    let totalHeight = 0;

    for (let index = start; index < end + 1; index++) {
      const height = this.getDefaultCellHeight();

      totalHeight += height;
    }

    return totalHeight;
  };

  protected getDefaultCellHeight(): number {
    return this.getRowCellHeight(null as unknown as Node) ?? 0;
  }

  protected getShadowFill = (angle: number) => {
    const { splitLine } = this.spreadsheet.theme;

    return `l (${angle}) 0:${splitLine?.shadowColors?.left} 1:${splitLine?.shadowColors?.right}`;
  };

  protected clip() {
    const { frozenGroupPositions: frozenGroupInfo, spreadsheet } = this;

    const isFrozenRowHeader = spreadsheet.isFrozenRowHeader();

    const frozenColGroupWidth = frozenGroupInfo[FrozenGroupPosition.Col].width;
    const frozenTrailingColWidth =
      frozenGroupInfo[FrozenGroupPosition.TrailingCol].width;
    const frozenRowGroupHeight =
      frozenGroupInfo[FrozenGroupPosition.Row].height;
    const frozenTrailingRowHeight =
      frozenGroupInfo[FrozenGroupPosition.TrailingRow].height;

    const panelScrollGroupClipX =
      (isFrozenRowHeader ? this.panelBBox.x : 0) + frozenColGroupWidth;
    const panelScrollGroupClipY = this.panelBBox.y + frozenRowGroupHeight;
    const panelScrollGroupClipWidth =
      this.panelBBox.width -
      frozenColGroupWidth -
      frozenTrailingColWidth +
      (isFrozenRowHeader ? 0 : this.panelBBox.x);
    const panelScrollGroupClipHeight =
      this.panelBBox.height - frozenRowGroupHeight - frozenTrailingRowHeight;

    this.panelScrollGroup.style.clipPath = new Rect({
      style: {
        x: panelScrollGroupClipX,
        y: panelScrollGroupClipY,
        width: panelScrollGroupClipWidth,
        height: panelScrollGroupClipHeight,
      },
    });

    /* frozen groups clip */
    this.frozenGroups[FrozenGroupType.Col].style.clipPath = new Rect({
      style: {
        x: this.panelBBox.x,
        y: panelScrollGroupClipY,
        width: frozenColGroupWidth,
        height: panelScrollGroupClipHeight,
      },
    });

    this.frozenGroups[FrozenGroupType.TrailingCol].style.clipPath = new Rect({
      style: {
        x: this.panelBBox.x + this.panelBBox.width - frozenTrailingColWidth,
        y: panelScrollGroupClipY,
        width: frozenTrailingColWidth,
        height: panelScrollGroupClipHeight,
      },
    });

    this.frozenGroups[FrozenGroupType.Row].style.clipPath = new Rect({
      style: {
        x: panelScrollGroupClipX,
        y: this.panelBBox.y,
        width: panelScrollGroupClipWidth,
        height: frozenRowGroupHeight,
      },
    });

    this.frozenGroups[FrozenGroupType.TrailingRow].style.clipPath = new Rect({
      style: {
        x: panelScrollGroupClipX,
        y: this.panelBBox.y + this.panelBBox.height - frozenTrailingRowHeight,
        width: panelScrollGroupClipWidth,
        height: frozenTrailingRowHeight,
      },
    });
  }
}

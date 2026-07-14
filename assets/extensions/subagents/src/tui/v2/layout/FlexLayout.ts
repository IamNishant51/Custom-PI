export type FlexDirection = "row" | "column" | "row-reverse" | "column-reverse";
export type JustifyContent = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly";
export type AlignItems = "flex-start" | "center" | "flex-end" | "stretch" | "baseline";
export type AlignSelf = "auto" | "flex-start" | "center" | "flex-end" | "stretch" | "baseline";
export type AlignContent = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "stretch";
export type PositionType = "relative" | "absolute";
export type OverflowType = "visible" | "hidden" | "scroll";

export interface FlexStyle {
  flexDirection?: FlexDirection;
  justifyContent?: JustifyContent;
  alignItems?: AlignItems;
  alignSelf?: AlignSelf;
  alignContent?: AlignContent;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
  position?: PositionType;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  overflow?: OverflowType;
}

export interface ComputedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlexNode {
  style: FlexStyle;
  children: FlexNode[];
  layout: ComputedLayout;
  _measured: boolean;
}

function resolveValue(value: number | string | undefined, parentSize: number): number {
  if (value === undefined) return NaN;
  if (typeof value === "number") return value;
  if (value.endsWith("%")) {
    return Math.floor(parentSize * parseFloat(value) / 100);
  }
  if (value === "auto") return NaN;
  return parseFloat(value);
}

function resolvePadding(padding: number | [number, number] | [number, number, number, number] | undefined): [number, number, number, number] {
  if (!padding) return [0, 0, 0, 0];
  if (typeof padding === "number") return [padding, padding, padding, padding];
  if (padding.length === 2) return [padding[0], padding[1], padding[0], padding[1]];
  return padding as [number, number, number, number];
}

function resolveMargin(margin: number | [number, number] | [number, number, number, number] | undefined): [number, number, number, number] {
  if (!margin) return [0, 0, 0, 0];
  if (typeof margin === "number") return [margin, margin, margin, margin];
  if (margin.length === 2) return [margin[0], margin[1], margin[0], margin[1]];
  return margin as [number, number, number, number];
}

export class FlexLayout {
  static computeLayout(node: FlexNode, parentWidth: number, parentHeight: number): void {
    node._measured = true;
    const style = node.style;
    const isRow = style.flexDirection === "row" || style.flexDirection === "row-reverse";
    const mainAxis = isRow ? "width" : "height";
    const crossAxis = isRow ? "height" : "width";
    const mainParent = isRow ? parentWidth : parentHeight;
    const crossParent = isRow ? parentHeight : parentWidth;

    const [paddingTop, paddingRight, paddingBottom, paddingLeft] = resolvePadding(style.padding);
    const [marginTop, marginRight, marginBottom, marginLeft] = resolveMargin(style.margin);

    const innerWidth = Math.max(0, parentWidth - paddingLeft - paddingRight - marginLeft - marginRight);
    const innerHeight = Math.max(0, parentHeight - paddingTop - paddingBottom - marginTop - marginBottom);

    // Measure children first
    for (const child of node.children) {
      if (!child._measured) {
        this.computeLayout(child, innerWidth, innerHeight);
      }
    }

    // Resolve flex basis
    const mainGap = style.gap ?? 0;
    let totalFlexGrow = 0;
    let totalFlexShrink = 0;
    let totalMainSize = 0;
    let hasAutoBasis = false;

    for (const child of node.children) {
      const childStyle = child.style;
      const basis = this._resolveFlexBasis(childStyle.flexBasis, mainAxis === "width" ? innerWidth : innerHeight);
      child.layout[mainAxis] = isNaN(basis) ? child.layout[mainAxis] : basis;
      
      if (!isNaN(basis)) {
        totalMainSize += basis;
      } else {
        totalMainSize += child.layout[mainAxis];
      }

      totalFlexGrow += childStyle.flexGrow ?? 0;
      totalFlexShrink += childStyle.flexShrink ?? 0;
      if (isNaN(basis)) hasAutoBasis = true;
    }

    // Distribute remaining space
    const usedSpace = totalMainSize + (node.children.length - 1) * mainGap;
    const remainingSpace = Math.max(0, (isRow ? innerWidth : innerHeight) - usedSpace);

    if (remainingSpace > 0 && totalFlexGrow > 0) {
      for (const child of node.children) {
        const grow = child.style.flexGrow ?? 0;
        if (grow > 0) {
          const added = (grow / totalFlexGrow) * remainingSpace;
          child.layout[mainAxis] += added;
        }
      }
    } else if (remainingSpace < 0 && totalFlexShrink > 0) {
      for (const child of node.children) {
        const shrink = child.style.flexShrink ?? 0;
        if (shrink > 0) {
          const reduced = (shrink / totalFlexShrink) * -remainingSpace;
          child.layout[mainAxis] = Math.max(0, child.layout[mainAxis] - reduced);
        }
      }
    }

    // Justify content (main axis)
    let mainPos = style.flexDirection === "row-reverse" || style.flexDirection === "column-reverse" 
      ? (isRow ? innerWidth : innerHeight) - marginRight - paddingRight
      : marginLeft + paddingLeft;

    switch (style.justifyContent) {
      case "center":
        mainPos = (isRow ? innerWidth : innerHeight) / 2 - (usedSpace - (node.children.length - 1) * mainGap) / 2;
        break;
      case "flex-end":
        mainPos = (isRow ? innerWidth : innerHeight) - usedSpace - marginRight - paddingRight;
        break;
      case "space-between":
        // Handled in child positioning
        break;
      case "space-around":
        mainPos += mainGap / 2;
        break;
      case "space-evenly":
        mainPos += mainGap;
        break;
    }

    // Position children
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childStyle = child.style;
      
      // Main axis position
      if (style.flexDirection === "row-reverse" || style.flexDirection === "column-reverse") {
        if (i > 0) {
          mainPos -= mainGap;
        }
        child.layout[isRow ? "x" : "y"] = mainPos - child.layout[mainAxis];
        mainPos -= child.layout[mainAxis];
      } else {
        child.layout[isRow ? "x" : "y"] = mainPos;
        mainPos += child.layout[mainAxis];
        if (i < node.children.length - 1) {
          mainPos += mainGap;
        }
      }

      // Cross axis positioning
      const crossSize = child.layout[isRow ? "height" : "width"];
      const crossPadding = isRow ? (style.padding ? resolvePadding(style.padding)[0] + resolvePadding(style.padding)[2] : 0) 
                                 : (style.padding ? resolvePadding(style.padding)[3] + resolvePadding(style.padding)[1] : 0);
      const crossInner = isRow ? parentHeight - (style.padding ? resolvePadding(style.padding)[0] + resolvePadding(style.padding)[2] : 0)
                                : parentWidth - (style.padding ? resolvePadding(style.padding)[3] + resolvePadding(style.padding)[1] : 0);

      switch (style.alignItems) {
        case "center":
          child.layout[isRow ? "y" : "x"] = (parentHeight - child.layout.height) / 2;
          break;
        case "flex-end":
          child.layout[isRow ? "y" : "x"] = parentHeight - child.layout.height;
          break;
        case "stretch":
          if (child.style.alignSelf !== "flex-start" && child.style.alignSelf !== "flex-end" && child.style.alignSelf !== "center") {
            child.layout[isRow ? "height" : "width"] = Math.max(0, parentHeight - (style.padding ? resolvePadding(style.padding)[0] + resolvePadding(style.padding)[2] : 0));
          }
          break;
      }

      if (child.style.alignSelf === "center") {
        child.layout[isRow ? "y" : "x"] = (parentHeight - child.layout.height) / 2;
      } else if (child.style.alignSelf === "flex-end") {
        child.layout[isRow ? "y" : "x"] = parentHeight - child.layout.height;
      }
    }

    // Set final position with margins
    node.layout.x = 0;
    node.layout.y = 0;
    node.layout.width = parentWidth;
    node.layout.height = parentHeight;
  }

  private static _resolveFlexBasis(basis: number | string | undefined, parentSize: number): number {
    if (basis === undefined || basis === "auto") return NaN;
    if (typeof basis === "number") return basis;
    if (typeof basis === "string" && basis.endsWith("%")) {
      return Math.floor(parentSize * parseFloat(basis) / 100);
    }
    return parseFloat(String(basis));
  }

  static createNode(style: FlexStyle = {}, children: FlexNode[] = []): FlexNode {
    return {
      style,
      children,
      layout: { x: 0, y: 0, width: 0, height: 0 },
      _measured: false,
    };
  }
}

export function flex(style: FlexStyle = {}): FlexNode {
  return FlexLayout.createNode(style);
}

export function spacer(flexGrow = 1): FlexNode {
  return FlexLayout.createNode({ flexGrow }, []);
}

export function divider(): FlexNode {
  return FlexLayout.createNode({ height: 1, flexShrink: 0 }, []);
}
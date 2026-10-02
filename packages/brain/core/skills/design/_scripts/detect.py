#!/usr/bin/env python3
"""
Design Anti-Pattern Detector
=============================
Deterministic static analysis for design anti-patterns in HTML/JSX/TSX/CSS files.
No LLM required. Uses only Python stdlib.

Usage:
    python3 detect.py <path> [--json|--pretty] [--severity critical|high|medium|low]

Exit codes:
    0 = clean (no findings)
    1 = error
    2 = findings detected

Output is SCAN-compatible JSON for /build CR integration.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCANNABLE_EXTENSIONS = {".html", ".jsx", ".tsx", ".vue", ".svelte", ".css"}

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

# Colors that are clearly "neutrals" (grays, whites, blacks) -- used by
# color-explosion to exclude from accent counting.
_NEUTRAL_HEX_PREFIXES = (
    "00", "11", "22", "33", "44", "55", "66", "77",
    "88", "99", "aa", "bb", "cc", "dd", "ee", "ff",
)

# Common generic hero copy phrases
GENERIC_HERO_PHRASES = [
    r"\bwelcome\s+to\b",
    r"\bthe\s+best\s+solution\b",
    r"\byour\s+one[- ]stop\b",
    r"\brevolutionize\b",
    r"\bsupercharge\b",
]

# Generic / system fonts (for default-font-only detection)
GENERIC_FONTS = {
    "inter", "roboto", "arial", "open sans", "helvetica",
    "sans-serif", "serif", "monospace", "system-ui",
    "ui-sans-serif", "ui-serif", "ui-monospace", "cursive",
    "fantasy", "helvetica neue", "segoe ui", "verdana",
    "tahoma", "georgia", "times new roman", "times",
    "courier new", "courier",
}

# AI-palette hex families (lowercased, without #)
AI_PURPLE_FAMILY = {"8b5cf6", "7c3aed", "6d28d9", "a78bfa", "9333ea"}
AI_PINK_FAMILY = {"ec4899", "db2777", "be185d", "f472b6", "d946ef"}
AI_CYAN_FAMILY = {"06b6d4", "0891b2", "22d3ee", "67e8f9", "0ea5e9"}

# Layout properties that should not be animated
LAYOUT_PROPERTIES = {
    "width", "height", "top", "left", "right", "bottom",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
}

# 4px grid values up to 256px (common design token scales)
GRID_4PX = set(range(0, 257, 4))
GRID_8PX = set(range(0, 257, 8))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_neutral_hex(hex_str: str) -> bool:
    """Check if a hex color is a neutral (gray/white/black)."""
    h = hex_str.lower().lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    if len(h) not in (6, 8):
        return False
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    # If all channels are within 30 of each other, it's a neutral
    spread = max(r, g, b) - min(r, g, b)
    return spread < 30


def hex_to_rgb(hex_str: str) -> tuple[int, int, int] | None:
    """Convert hex color to (r, g, b). Returns None on parse failure."""
    h = hex_str.lower().lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    if len(h) not in (6, 8):
        return None
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except ValueError:
        return None


def relative_luminance(r: int, g: int, b: int) -> float:
    """Calculate relative luminance per WCAG 2.0."""
    def linearize(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)


def contrast_ratio(rgb1: tuple[int, int, int], rgb2: tuple[int, int, int]) -> float:
    """Calculate contrast ratio between two RGB colors."""
    l1 = relative_luminance(*rgb1)
    l2 = relative_luminance(*rgb2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def px_value(val: str) -> float | None:
    """Extract a pixel value from a CSS size string. Converts rem to px (1rem=16px)."""
    val = val.strip().lower()
    m = re.match(r"^(-?[\d.]+)\s*px$", val)
    if m:
        return float(m.group(1))
    m = re.match(r"^(-?[\d.]+)\s*rem$", val)
    if m:
        return float(m.group(1)) * 16.0
    m = re.match(r"^(-?[\d.]+)\s*em$", val)
    if m:
        return float(m.group(1)) * 16.0  # Approximate
    return None


def extract_tailwind_spacing_px(cls: str) -> float | None:
    """Convert a Tailwind spacing class like p-4, m-6 to pixel value."""
    # Tailwind spacing scale: 1 = 4px (0.25rem)
    m = re.match(r"^[mp][xytblr]?-(\d+(?:\.\d+)?)$", cls)
    if m:
        return float(m.group(1)) * 4.0
    m = re.match(r"^[mp][xytblr]?-\[(\d+(?:\.\d+)?)(px|rem)\]$", cls)
    if m:
        val = float(m.group(1))
        unit = m.group(2)
        if unit == "rem":
            val *= 16
        return val
    return None


# ---------------------------------------------------------------------------
# Finding dataclass
# ---------------------------------------------------------------------------

class Finding:
    """A single anti-pattern finding."""

    __slots__ = ("rule", "severity", "file", "line", "column", "evidence", "suggestion")

    def __init__(self, rule: str, severity: str, file: str, line: int,
                 evidence: str, suggestion: str, column: int = 0):
        self.rule = rule
        self.severity = severity
        self.file = file
        self.line = line
        self.column = column
        self.evidence = evidence
        self.suggestion = suggestion

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "severity": self.severity,
            "file": self.file,
            "line": self.line,
            "column": self.column,
            "evidence": self.evidence,
            "suggestion": self.suggestion,
        }


# ---------------------------------------------------------------------------
# Rule implementations
# ---------------------------------------------------------------------------

class RuleEngine:
    """Runs all anti-pattern rules against file content."""

    def __init__(self):
        self.findings: list[Finding] = []
        self.files_scanned: int = 0
        # Cross-file accumulators
        self._all_shadows: list[str] = []
        self._all_accent_colors: list[str] = []
        self._all_border_radii: list[str] = []
        self._all_padding_values: list[str] = []
        self._all_fonts: set[str] = set()
        self._file_padding_map: dict[str, list[str]] = defaultdict(list)
        self._has_display_font = False
        # Track animation properties and reduced-motion per file
        self._file_has_animation: dict[str, list[tuple[int, str]]] = defaultdict(list)
        self._file_has_reduced_motion: dict[str, bool] = defaultdict(bool)
        # Track :hover without :focus
        self._file_hover_selectors: dict[str, list[tuple[int, str]]] = defaultdict(list)
        self._file_focus_selectors: dict[str, set[str]] = defaultdict(set)

    def scan_file(self, filepath: str) -> None:
        """Scan a single file for anti-patterns."""
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except (IOError, OSError):
            return

        self.files_scanned += 1
        lines = content.split("\n")
        ext = Path(filepath).suffix.lower()
        is_css = ext == ".css"
        is_component = ext in {".jsx", ".tsx", ".vue", ".svelte"}
        is_html = ext == ".html"

        for line_num, line in enumerate(lines, start=1):
            self._check_line(filepath, line_num, line, is_css, is_component, is_html)

        # Full-content checks
        self._check_full_content(filepath, content, lines, is_css, is_component)

    def _check_line(self, fp: str, ln: int, line: str, is_css: bool,
                    is_component: bool, is_html: bool) -> None:
        """Per-line rule checks."""
        stripped = line.strip()

        # --- CRITICAL ---

        # 1. contrast-ratio-fail (inline styles only; CSS custom props are complex)
        self._check_contrast_inline(fp, ln, line)

        # 2. tiny-body-text
        self._check_tiny_text(fp, ln, line, stripped, is_css)

        # --- HIGH ---

        # 4. gradient-text
        if "background-clip" in line.lower() and "text" in line.lower():
            self.findings.append(Finding(
                rule="gradient-text",
                severity="high",
                file=fp, line=ln,
                evidence=stripped[:120],
                suggestion="Use solid color for text. Gradient text reduces readability and is an AI design tell.",
            ))

        # 5. ai-color-palette (accumulate colors per file)
        self._collect_ai_colors(fp, ln, line)

        # 7. generic-hero-copy
        if is_component or is_html:
            self._check_generic_hero(fp, ln, line, stripped)

        # 9. line-length-violation (Tailwind max-w and CSS max-width)
        self._check_line_length_violation(fp, ln, line, stripped, is_css)

        # 13. glassmorphism
        if "backdrop-filter" in line.lower() and "blur" in line.lower():
            self.findings.append(Finding(
                rule="glassmorphism",
                severity="medium",
                file=fp, line=ln,
                evidence=stripped[:120],
                suggestion="Glassmorphism (backdrop-filter: blur) is overdone. Consider solid or subtly transparent backgrounds.",
            ))

        # 17. layout-property-animation
        self._check_layout_animation(fp, ln, line, stripped)

        # 22. z-index-war
        self._check_zindex(fp, ln, line, stripped)

        # 23. hardcoded-color (in component files)
        if is_component:
            self._check_hardcoded_color(fp, ln, line, stripped)

        # 25. stale-todo-comment
        if is_component or is_html:
            self._check_stale_todo(fp, ln, stripped)

        # Accumulators for cross-file rules
        self._collect_shadows(line, stripped)
        self._collect_border_radii(line, stripped)
        self._collect_padding(fp, line, stripped)
        self._collect_fonts(line)

        # Track animations and reduced-motion
        self._track_animation(fp, ln, line, stripped)
        self._track_reduced_motion(fp, line)

        # Track hover/focus
        self._track_hover_focus(fp, ln, line, stripped, is_css)

    def _check_contrast_inline(self, fp: str, ln: int, line: str) -> None:
        """Rule 1: contrast-ratio-fail -- check inline style color vs background-color."""
        # Look for inline style attributes with both color and background
        style_match = re.search(r'style\s*=\s*["\{]["\{]?\s*([^"}>]+)', line, re.IGNORECASE)
        if not style_match:
            return
        style_str = style_match.group(1)
        # Extract color and background-color
        fg_match = re.search(r'(?<![a-z-])color\s*:\s*["\']?(#[0-9a-fA-F]{3,8})', style_str)
        bg_match = re.search(r'background(?:-color)?\s*:\s*["\']?(#[0-9a-fA-F]{3,8})', style_str)
        if fg_match and bg_match:
            fg_rgb = hex_to_rgb(fg_match.group(1))
            bg_rgb = hex_to_rgb(bg_match.group(1))
            if fg_rgb and bg_rgb:
                ratio = contrast_ratio(fg_rgb, bg_rgb)
                if ratio < 3.0:
                    self.findings.append(Finding(
                        rule="contrast-ratio-fail",
                        severity="critical",
                        file=fp, line=ln,
                        evidence=f"Contrast ratio {ratio:.2f}:1 between {fg_match.group(1)} and {bg_match.group(1)}",
                        suggestion="WCAG requires at least 3:1 for large text, 4.5:1 for normal text. Increase contrast.",
                    ))

    def _check_tiny_text(self, fp: str, ln: int, line: str, stripped: str, is_css: bool) -> None:
        """Rule 2: tiny-body-text -- body/paragraph text below 16px."""
        # CSS: font-size on body/p/span/div selectors
        if is_css:
            # Check for font-size declarations with small values
            fs_match = re.search(r"font-size\s*:\s*([\d.]+(?:px|rem|em))", stripped, re.IGNORECASE)
            if fs_match:
                px = px_value(fs_match.group(1))
                if px is not None and px < 16 and px > 0:
                    self.findings.append(Finding(
                        rule="tiny-body-text",
                        severity="critical",
                        file=fp, line=ln,
                        evidence=f"font-size: {fs_match.group(1)} ({px}px)",
                        suggestion="Body text should be at least 16px for readability. Use >= 1rem.",
                    ))
            return

        # Inline styles
        fs_inline = re.search(r"font-?[Ss]ize[\"']?\s*[:=]\s*[\"']?([\d.]+(?:px|rem|em))", line)
        if fs_inline:
            px = px_value(fs_inline.group(1))
            if px is not None and px < 16 and px > 0:
                self.findings.append(Finding(
                    rule="tiny-body-text",
                    severity="critical",
                    file=fp, line=ln,
                    evidence=f"fontSize: {fs_inline.group(1)} ({px}px)",
                    suggestion="Body text should be at least 16px for readability. Use >= 1rem.",
                ))

        # Tailwind: text-xs (12px), text-sm (14px)
        if re.search(r'\btext-(?:xs|sm)\b', line):
            # Only flag in body/paragraph context (not labels, captions, etc.)
            # Heuristic: flag if it's on a <p>, <span>, or generic div
            if re.search(r'<(?:p|span|div|section|article)\b', line, re.IGNORECASE) or \
               re.search(r'className\s*=\s*["\'][^"\']*\btext-(?:xs|sm)\b', line):
                tw_class = "text-xs" if "text-xs" in line else "text-sm"
                px_val = 12 if tw_class == "text-xs" else 14
                self.findings.append(Finding(
                    rule="tiny-body-text",
                    severity="critical",
                    file=fp, line=ln,
                    evidence=f"Tailwind class '{tw_class}' = {px_val}px",
                    suggestion="Body text should be at least 16px. Use text-base or larger for body content.",
                ))

    def _collect_ai_colors(self, fp: str, ln: int, line: str) -> None:
        """Rule 5: ai-color-palette -- detect AI-ish color patterns."""
        hex_colors = re.findall(r"#([0-9a-fA-F]{6})\b", line)
        for hc in hex_colors:
            hcl = hc.lower()
            if hcl in AI_PURPLE_FAMILY or hcl in AI_PINK_FAMILY or hcl in AI_CYAN_FAMILY:
                self.findings.append(Finding(
                    rule="ai-color-palette",
                    severity="high",
                    file=fp, line=ln,
                    evidence=f"#{hcl} is in the AI color palette family",
                    suggestion="Purple-pink gradients and neon cyan are AI design tells. Choose a distinctive brand palette.",
                ))

        # Also check Tailwind classes for AI palette colors
        ai_tw_patterns = [
            (r"\bfrom-purple-\d+\b.*\bto-pink-\d+\b", "purple-to-pink gradient"),
            (r"\bfrom-violet-\d+\b.*\bto-fuchsia-\d+\b", "violet-to-fuchsia gradient"),
            (r"\bfrom-indigo-\d+\b.*\bto-pink-\d+\b", "indigo-to-pink gradient"),
            (r"\bcyan-[456]\d{2}\b", "neon cyan accent"),
        ]
        for pat, desc in ai_tw_patterns:
            if re.search(pat, line, re.IGNORECASE):
                self.findings.append(Finding(
                    rule="ai-color-palette",
                    severity="high",
                    file=fp, line=ln,
                    evidence=f"Tailwind classes suggest {desc}",
                    suggestion="Purple-pink gradients and neon cyan are AI design tells. Choose a distinctive brand palette.",
                ))

    def _check_generic_hero(self, fp: str, ln: int, line: str, stripped: str) -> None:
        """Rule 7: generic-hero-copy."""
        line_lower = line.lower()
        for pattern in GENERIC_HERO_PHRASES:
            if re.search(pattern, line_lower):
                matched = re.search(pattern, line_lower).group(0)  # type: ignore
                self.findings.append(Finding(
                    rule="generic-hero-copy",
                    severity="high",
                    file=fp, line=ln,
                    evidence=f"Generic phrase: '{matched}' in UI text",
                    suggestion="Replace generic marketing copy with specific value props. What exactly does this product do?",
                ))
                break  # One finding per line

    def _check_line_length_violation(self, fp: str, ln: int, line: str,
                                     stripped: str, is_css: bool) -> None:
        """Rule 9: line-length-violation -- text containers > 75ch without max-width."""
        # CSS: width > 75ch without max-width
        if is_css:
            if re.search(r"width\s*:\s*100%", stripped) and "max-width" not in stripped:
                # This is a potential issue but need more context; skip for single-line
                pass
            return

        # Tailwind: look for w-full or w-screen without max-w-*
        if re.search(r'\bw-(?:full|screen)\b', line):
            # Check if same className string has max-w
            cn_match = re.search(r'className\s*=\s*["\']([^"\']+)["\']', line)
            if cn_match and "max-w-" not in cn_match.group(1) and "max-w-prose" not in cn_match.group(1):
                # Only flag text containers (heuristic: if it contains text-related classes)
                classes = cn_match.group(1)
                if re.search(r'\btext-(?:sm|base|lg|xl)', classes) or \
                   re.search(r'\bprose\b', classes) or \
                   re.search(r'\bleading-', classes):
                    self.findings.append(Finding(
                        rule="line-length-violation",
                        severity="high",
                        file=fp, line=ln,
                        evidence=f"Full-width text container without max-width constraint",
                        suggestion="Add max-w-prose or max-w-[75ch] to text containers for readability.",
                    ))

    def _check_layout_animation(self, fp: str, ln: int, line: str, stripped: str) -> None:
        """Rule 17: layout-property-animation."""
        # CSS transition/animation of layout properties
        if "transition" in line.lower() or "animation" in line.lower():
            for prop in LAYOUT_PROPERTIES:
                if re.search(rf"\b{prop}\b", stripped, re.IGNORECASE):
                    # Make sure it's actually a transition/animation property, not a value
                    if re.search(rf"transition[^;]*\b{prop}\b", stripped, re.IGNORECASE) or \
                       re.search(rf"animate-\[.*{prop}", stripped, re.IGNORECASE):
                        self.findings.append(Finding(
                            rule="layout-property-animation",
                            severity="medium",
                            file=fp, line=ln,
                            evidence=f"Animating layout property: {prop}",
                            suggestion=f"Animating '{prop}' causes layout recalc. Use transform/opacity instead.",
                        ))
                        break

    def _check_zindex(self, fp: str, ln: int, line: str, stripped: str) -> None:
        """Rule 22: z-index-war."""
        z_match = re.search(r"z-(?:index\s*:\s*|(?:\[)?)(\d+)", line)
        if z_match:
            z_val = int(z_match.group(1))
            # z-index > 100 is suspicious (modals at 50 are fine)
            if z_val > 100:
                # Check if it's a modal/overlay context
                line_lower = line.lower()
                is_modal = any(w in line_lower for w in ["modal", "overlay", "dialog", "drawer", "tooltip", "popover"])
                if not is_modal:
                    self.findings.append(Finding(
                        rule="z-index-war",
                        severity="low",
                        file=fp, line=ln,
                        evidence=f"z-index: {z_val}",
                        suggestion="z-index > 100 suggests stacking context issues. Use a z-index scale (10, 20, 30, 40, 50).",
                    ))

    def _check_hardcoded_color(self, fp: str, ln: int, line: str, stripped: str) -> None:
        """Rule 23: hardcoded-color -- inline hex/rgb/hsl in component files."""
        # Skip import lines, comments, and CSS variable definitions
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            return
        if "--" in stripped and ":" in stripped:
            return  # CSS custom property definition
        if "import " in stripped:
            return

        # Find inline color values in style attributes or style objects
        if "style" in line.lower() or "color" in line.lower() or "background" in line.lower():
            hex_match = re.search(r'["\']#[0-9a-fA-F]{3,8}["\']', line)
            rgb_match = re.search(r'\brgba?\s*\(\s*\d+', line)
            hsl_match = re.search(r'\bhsla?\s*\(\s*\d+', line)
            if hex_match or rgb_match or hsl_match:
                evidence = (hex_match or rgb_match or hsl_match).group(0)  # type: ignore
                self.findings.append(Finding(
                    rule="hardcoded-color",
                    severity="low",
                    file=fp, line=ln,
                    evidence=f"Inline color value: {evidence[:60]}",
                    suggestion="Use CSS variables or design tokens instead of hardcoded color values.",
                ))

    def _check_stale_todo(self, fp: str, ln: int, stripped: str) -> None:
        """Rule 25: stale-todo-comment."""
        if re.search(r"\b(TODO|FIXME|HACK|XXX)\b", stripped):
            # Only in code comments
            if stripped.startswith("//") or stripped.startswith("*") or \
               stripped.startswith("/*") or stripped.startswith("{/*") or \
               stripped.startswith("<!--"):
                self.findings.append(Finding(
                    rule="stale-todo-comment",
                    severity="low",
                    file=fp, line=ln,
                    evidence=stripped[:100],
                    suggestion="Resolve or track TODO/FIXME/HACK comments. Stale comments erode codebase trust.",
                ))

    def _collect_shadows(self, line: str, stripped: str) -> None:
        """Accumulate box-shadow values for rule 15."""
        shadow_match = re.search(r"box-shadow\s*:\s*([^;}{]+)", line, re.IGNORECASE)
        if shadow_match:
            self._all_shadows.append(shadow_match.group(1).strip())
        # Tailwind shadow classes
        tw_shadow = re.findall(r"\bshadow-(?:sm|md|lg|xl|2xl|inner|none)\b", line)
        self._all_shadows.extend(tw_shadow)

    def _collect_border_radii(self, line: str, stripped: str) -> None:
        """Accumulate border-radius values for rule 20."""
        br_match = re.search(r"border-radius\s*:\s*([^;}{]+)", line, re.IGNORECASE)
        if br_match:
            self._all_border_radii.append(br_match.group(1).strip())
        # Tailwind rounded classes
        tw_rounded = re.findall(r"\brounded(?:-(?:sm|md|lg|xl|2xl|3xl|full|none))?\b", line)
        self._all_border_radii.extend(tw_rounded)

    def _collect_padding(self, fp: str, line: str, stripped: str) -> None:
        """Accumulate padding values for rule 11."""
        # CSS padding
        pad_match = re.search(r"padding\s*:\s*([^;}{]+)", line, re.IGNORECASE)
        if pad_match:
            val = pad_match.group(1).strip()
            self._all_padding_values.append(val)
            self._file_padding_map[fp].append(val)
        # Tailwind padding
        tw_pads = re.findall(r"\bp[xytblr]?-(\d+(?:\.\d+)?|\[\d+(?:px|rem)\])\b", line)
        for p in tw_pads:
            self._all_padding_values.append(f"p-{p}")
            self._file_padding_map[fp].append(f"p-{p}")

    def _collect_fonts(self, line: str) -> None:
        """Accumulate font-family values for rule 12."""
        ff_match = re.search(r"font-family\s*:\s*([^;}{]+)", line, re.IGNORECASE)
        if ff_match:
            fonts = [f.strip().strip("'\"").lower() for f in ff_match.group(1).split(",")]
            for f in fonts:
                self._all_fonts.add(f)
                if f not in GENERIC_FONTS:
                    self._has_display_font = True
        # Tailwind font classes
        tw_font = re.findall(r"\bfont-\[([\w\s,]+)\]", line)
        for tf in tw_font:
            fonts = [f.strip().strip("'\"").lower() for f in tf.split(",")]
            for f in fonts:
                self._all_fonts.add(f)
                if f not in GENERIC_FONTS:
                    self._has_display_font = True

    def _track_animation(self, fp: str, ln: int, line: str, stripped: str) -> None:
        """Track animation/transition declarations for rule 10."""
        if re.search(r"\b(animation|transition|@keyframes)\b", line, re.IGNORECASE) or \
           re.search(r"\banimate-\w+", line):
            self._file_has_animation[fp].append((ln, stripped[:100]))

    def _track_reduced_motion(self, fp: str, line: str) -> None:
        """Track prefers-reduced-motion queries for rule 10."""
        if "prefers-reduced-motion" in line:
            self._file_has_reduced_motion[fp] = True

    def _track_hover_focus(self, fp: str, ln: int, line: str, stripped: str, is_css: bool) -> None:
        """Track :hover and :focus selectors for rules 3 and 8."""
        if is_css:
            if ":hover" in line:
                selector = stripped.split("{")[0].strip() if "{" in stripped else stripped
                base = re.sub(r":hover\b", "", selector).strip()
                self._file_hover_selectors[fp].append((ln, base))
            if ":focus" in line or ":focus-visible" in line or ":focus-within" in line:
                selector = stripped.split("{")[0].strip() if "{" in stripped else stripped
                base = re.sub(r":focus(?:-visible|-within)?\b", "", selector).strip()
                self._file_focus_selectors[fp].add(base)
        else:
            # Tailwind: hover: without focus: equivalent
            if re.search(r"\bhover:", line):
                # Check same className for focus: variant
                cn_match = re.search(r'className\s*=\s*["\']([^"\']+)["\']', line)
                if cn_match:
                    classes = cn_match.group(1)
                    has_hover = "hover:" in classes
                    has_focus = "focus:" in classes or "focus-visible:" in classes
                    if has_hover and not has_focus:
                        self._file_hover_selectors[fp].append((ln, "tailwind-hover"))

    def _check_full_content(self, fp: str, content: str, lines: list[str],
                            is_css: bool, is_component: bool) -> None:
        """Full-file content checks."""

        # 3. missing-focus-visible (for interactive elements in component files)
        if is_component:
            self._check_missing_focus(fp, content, lines)

        # 6. nested-cards
        if is_component or fp.endswith(".html"):
            self._check_nested_cards(fp, content, lines)

        # 14. random-spacing
        self._check_random_spacing(fp, content, lines)

        # 16. color-explosion
        if is_component:
            self._check_color_explosion(fp, content, lines)

        # 18. missing-empty-state
        if is_component:
            self._check_missing_empty_state(fp, content, lines)

        # 19. placeholder-only-label
        if is_component or fp.endswith(".html"):
            self._check_placeholder_only_label(fp, content, lines)

        # 21. icon-without-label
        if is_component or fp.endswith(".html"):
            self._check_icon_without_label(fp, content, lines)

        # 24. excessive-nesting
        if is_component or fp.endswith(".html"):
            self._check_excessive_nesting(fp, content, lines)

    def _check_missing_focus(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 3: missing-focus-visible for interactive elements."""
        # Find interactive elements: <button, <a, <input, <select, <textarea
        interactive_pattern = re.compile(
            r"<(button|a|input|select|textarea)\b", re.IGNORECASE
        )
        for ln, line in enumerate(lines, 1):
            match = interactive_pattern.search(line)
            if match:
                tag = match.group(1).lower()
                # Check if className includes focus: or focus-visible: (Tailwind)
                cn_match = re.search(r'className\s*=\s*["\']([^"\']+)["\']', line)
                if cn_match:
                    classes = cn_match.group(1)
                    if "focus:" in classes or "focus-visible:" in classes or "focus-within:" in classes:
                        continue  # Has focus styles
                # Check if the element has an explicit focus style somewhere
                # (simplified: just check the file for :focus on similar selectors)
                if ":focus" in content or "focus:" in content or "focus-visible:" in content:
                    continue  # File has focus handling somewhere
                self.findings.append(Finding(
                    rule="missing-focus-visible",
                    severity="critical",
                    file=fp, line=ln,
                    evidence=f"<{tag}> without :focus-visible or focus: styles",
                    suggestion=f"Add :focus-visible styles to <{tag}> for keyboard accessibility.",
                ))

    def _check_nested_cards(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 6: nested-cards -- card-like elements inside other card-like elements."""
        # Heuristic: elements with both rounded corners and shadow/border are "cards"
        # In Tailwind: rounded-* + shadow-* or border
        card_pattern = re.compile(
            r'className\s*=\s*["\']([^"\']*\brounded(?:-\w+)?\b[^"\']*(?:\bshadow(?:-\w+)?\b|\bborder\b)[^"\']*)["\']'
        )
        # Also check reverse order
        card_pattern_rev = re.compile(
            r'className\s*=\s*["\']([^"\']*(?:\bshadow(?:-\w+)?\b|\bborder\b)[^"\']*\brounded(?:-\w+)?\b[^"\']*)["\']'
        )

        # Track nesting depth of card-like elements
        card_depth = 0
        open_tags: list[tuple[int, int]] = []  # (line_num, depth)

        for ln, line in enumerate(lines, 1):
            is_card = card_pattern.search(line) or card_pattern_rev.search(line)

            # Count opening/closing tags
            opens = len(re.findall(r"<(?:div|section|article|aside|li)\b", line, re.IGNORECASE))
            closes = len(re.findall(r"</(?:div|section|article|aside|li)\b", line, re.IGNORECASE))

            if is_card:
                if card_depth > 0:
                    self.findings.append(Finding(
                        rule="nested-cards",
                        severity="high",
                        file=fp, line=ln,
                        evidence="Card-like element (rounded + shadow/border) nested inside another card",
                        suggestion="Avoid nesting cards. Use flat layouts or distinct visual hierarchy without nested containers.",
                    ))
                card_depth += 1
                open_tags.append((ln, card_depth))

            card_depth = max(0, card_depth + opens - closes)

    def _check_random_spacing(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 14: random-spacing -- non-grid-aligned spacing values."""
        px_values_found = []
        for ln, line in enumerate(lines, 1):
            # CSS px values
            for m in re.finditer(r"(?:margin|padding|gap|top|left|right|bottom)\s*:\s*(-?\d+)px", line, re.IGNORECASE):
                val = abs(int(m.group(1)))
                if val > 0 and val not in GRID_4PX:
                    self.findings.append(Finding(
                        rule="random-spacing",
                        severity="medium",
                        file=fp, line=ln,
                        evidence=f"{val}px is not on a 4px grid",
                        suggestion=f"Use spacing values on a 4px grid (4, 8, 12, 16, 20, 24...). Nearest: {round(val / 4) * 4}px.",
                    ))

            # Tailwind arbitrary values
            for m in re.finditer(r"[mp][xytblr]?-\[(\d+)px\]", line):
                val = int(m.group(1))
                if val > 0 and val not in GRID_4PX:
                    self.findings.append(Finding(
                        rule="random-spacing",
                        severity="medium",
                        file=fp, line=ln,
                        evidence=f"Tailwind arbitrary spacing {val}px is not on a 4px grid",
                        suggestion=f"Use spacing values on a 4px grid. Nearest: {round(val / 4) * 4}px.",
                    ))

    def _check_color_explosion(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 16: color-explosion -- too many distinct accent colors."""
        accent_colors = set()
        for line in lines:
            for m in re.finditer(r"#([0-9a-fA-F]{6})\b", line):
                hc = m.group(1).lower()
                if not is_neutral_hex(hc):
                    accent_colors.add(hc)
        # Also count distinct Tailwind color families (excluding gray/slate/zinc/neutral/stone)
        tw_color_families = set()
        neutral_families = {"gray", "slate", "zinc", "neutral", "stone", "white", "black"}
        for line in lines:
            for m in re.finditer(r"\b(?:text|bg|border|ring|from|to|via)-(\w+)-\d+", line):
                family = m.group(1).lower()
                if family not in neutral_families:
                    tw_color_families.add(family)

        total_accents = len(accent_colors) + len(tw_color_families)
        if total_accents > 4:
            self.findings.append(Finding(
                rule="color-explosion",
                severity="medium",
                file=fp, line=1,
                evidence=f"{total_accents} distinct accent colors in this file",
                suggestion="Limit accent colors to 2-3 plus neutrals. Too many colors fragment visual identity.",
            ))

    def _check_missing_empty_state(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 18: missing-empty-state -- conditional renders without fallback."""
        for ln, line in enumerate(lines, 1):
            # {items.length > 0 && ...} or {data && ...} or {list.length && ...}
            if re.search(r"\{\s*\w+(?:\.\w+)*\.length\s*(?:>|&&)", line):
                # Check if there's a corresponding else/fallback within a few lines
                context_window = "\n".join(lines[max(0, ln-1):min(len(lines), ln+10)])
                if not re.search(r"(?:\.length\s*===?\s*0|:\s*\(|<\w+Empty|empty|no\s+\w+\s+found|fallback)", context_window, re.IGNORECASE):
                    self.findings.append(Finding(
                        rule="missing-empty-state",
                        severity="medium",
                        file=fp, line=ln,
                        evidence="Conditional render without empty state fallback",
                        suggestion="Add an empty state for when the list is empty. Users shouldn't see blank space.",
                    ))

    def _check_placeholder_only_label(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 19: placeholder-only-label -- input with placeholder but no label."""
        for ln, line in enumerate(lines, 1):
            if re.search(r"<input\b", line, re.IGNORECASE) and \
               re.search(r"\bplaceholder\s*=", line, re.IGNORECASE):
                # Check surrounding context for a <label> element
                context_start = max(0, ln - 5)
                context_end = min(len(lines), ln + 3)
                context = "\n".join(lines[context_start:context_end])
                has_label = re.search(r"<label\b", context, re.IGNORECASE)
                has_aria = re.search(r"aria-label(?:ledby)?\s*=", line, re.IGNORECASE)
                has_sr = re.search(r"\bsr-only\b", context)
                if not has_label and not has_aria and not has_sr:
                    self.findings.append(Finding(
                        rule="placeholder-only-label",
                        severity="medium",
                        file=fp, line=ln,
                        evidence="<input> has placeholder but no associated <label> or aria-label",
                        suggestion="Add a visible <label> or aria-label. Placeholders disappear on focus.",
                    ))

    def _check_icon_without_label(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 21: icon-without-label -- button/link with only an icon."""
        for ln, line in enumerate(lines, 1):
            # Look for button or a tags containing only SVG/icon elements
            icon_btn = re.search(
                r"<(button|a)\b[^>]*>\s*(?:<svg\b|<\w*[Ii]con\b|<img\b)",
                line, re.IGNORECASE
            )
            if icon_btn:
                has_label = re.search(r"aria-label\s*=", line, re.IGNORECASE)
                has_sr = re.search(r"\bsr-only\b", line)
                has_title = re.search(r"title\s*=", line, re.IGNORECASE)
                # Check if there's visible text after the icon on same/next line
                context = line + (lines[ln] if ln < len(lines) else "")
                has_text = re.search(r">\s*\w{2,}", context)  # At least 2 chars of text
                if not has_label and not has_sr and not has_title and not has_text:
                    self.findings.append(Finding(
                        rule="icon-without-label",
                        severity="low",
                        file=fp, line=ln,
                        evidence=f"<{icon_btn.group(1)}> contains icon without accessible label",
                        suggestion="Add aria-label, title, or sr-only text for screen readers.",
                    ))

    def _check_excessive_nesting(self, fp: str, content: str, lines: list[str]) -> None:
        """Rule 24: excessive-nesting -- deep div nesting without semantic elements."""
        depth = 0
        max_depth = 0
        max_depth_line = 0
        # Semantic elements that reset/don't count toward the nesting smell
        semantic_tags = {"main", "nav", "header", "footer", "section", "article", "aside", "form", "fieldset", "ul", "ol", "table"}

        for ln, line in enumerate(lines, 1):
            # Count non-semantic opening tags
            for m in re.finditer(r"<(div|span)\b", line, re.IGNORECASE):
                depth += 1
                if depth > max_depth:
                    max_depth = depth
                    max_depth_line = ln

            # Count closing tags
            for m in re.finditer(r"</(div|span)\b", line, re.IGNORECASE):
                depth = max(0, depth - 1)

            # Semantic tags reset concern
            if re.search(r"<(?:" + "|".join(semantic_tags) + r")\b", line, re.IGNORECASE):
                depth = max(0, depth - 1)  # Semantic element reduces smell

        if max_depth > 4:
            self.findings.append(Finding(
                rule="excessive-nesting",
                severity="low",
                file=fp, line=max_depth_line,
                evidence=f"Nesting depth of {max_depth} (non-semantic elements)",
                suggestion="Reduce div nesting. Use semantic HTML (section, article, nav, aside) or flatten with flexbox/grid.",
            ))

    def finalize(self) -> None:
        """Run cross-file checks after all files are scanned."""

        # 8. hover-only-interaction
        for fp, hovers in self._file_hover_selectors.items():
            focus_selectors = self._file_focus_selectors.get(fp, set())
            for ln, base in hovers:
                if base == "tailwind-hover":
                    self.findings.append(Finding(
                        rule="hover-only-interaction",
                        severity="high",
                        file=fp, line=ln,
                        evidence="Tailwind hover: variant without matching focus: variant",
                        suggestion="Add focus: or focus-visible: variant alongside hover: for keyboard accessibility.",
                    ))
                elif base not in focus_selectors:
                    self.findings.append(Finding(
                        rule="hover-only-interaction",
                        severity="high",
                        file=fp, line=ln,
                        evidence=f":hover without matching :focus/:focus-visible on '{base}'",
                        suggestion="Add :focus-visible styles alongside :hover for keyboard users.",
                    ))

        # 10. missing-reduced-motion
        for fp, animations in self._file_has_animation.items():
            if animations and not self._file_has_reduced_motion.get(fp, False):
                # Report on first animation found
                ln, evidence = animations[0]
                self.findings.append(Finding(
                    rule="missing-reduced-motion",
                    severity="high",
                    file=fp, line=ln,
                    evidence=f"Animation/transition without prefers-reduced-motion: {evidence}",
                    suggestion="Add @media (prefers-reduced-motion: reduce) to disable/reduce animations.",
                ))

        # 11. equal-padding-everywhere
        if self._all_padding_values:
            counter = Counter(self._all_padding_values)
            total = len(self._all_padding_values)
            most_common_val, most_common_count = counter.most_common(1)[0]
            if total >= 5 and most_common_count / total >= 0.8:
                self.findings.append(Finding(
                    rule="equal-padding-everywhere",
                    severity="medium",
                    file="(project-wide)",
                    line=0,
                    evidence=f"'{most_common_val}' used for {most_common_count}/{total} ({most_common_count*100//total}%) of padding declarations",
                    suggestion="Vary padding to create visual hierarchy. Use tighter padding for dense UI, looser for breathing room.",
                ))

        # 12. default-font-only
        if self._all_fonts and not self._has_display_font:
            self.findings.append(Finding(
                rule="default-font-only",
                severity="medium",
                file="(project-wide)",
                line=0,
                evidence=f"Only generic/system fonts detected: {', '.join(sorted(self._all_fonts)[:5])}",
                suggestion="Add a distinctive display or heading font to differentiate from generic defaults.",
            ))

        # 15. shadow-overload
        unique_shadows = set(self._all_shadows)
        if len(unique_shadows) > 3:
            self.findings.append(Finding(
                rule="shadow-overload",
                severity="medium",
                file="(project-wide)",
                line=0,
                evidence=f"{len(unique_shadows)} distinct shadow values across components",
                suggestion="Standardize shadows to 2-3 elevation levels (sm, md, lg). Inconsistent shadows look unpolished.",
            ))

        # 20. orphan-border-radius
        unique_radii = set(self._all_border_radii)
        if len(unique_radii) > 3:
            # Check for mixing px and rem
            has_px = any("px" in r for r in unique_radii)
            has_rem = any("rem" in r for r in unique_radii)
            mixed_units = has_px and has_rem
            if mixed_units or len(unique_radii) > 4:
                evidence = f"{len(unique_radii)} distinct border-radius values"
                if mixed_units:
                    evidence += " (mixing px and rem units)"
                self.findings.append(Finding(
                    rule="orphan-border-radius",
                    severity="low",
                    file="(project-wide)",
                    line=0,
                    evidence=evidence,
                    suggestion="Standardize border-radius to 2-3 values. Use design tokens for consistency.",
                ))

    def get_results(self, severity_filter: str | None = None) -> dict[str, Any]:
        """Build the SCAN-compatible output."""
        self.finalize()

        findings = self.findings
        if severity_filter:
            min_severity = SEVERITY_ORDER.get(severity_filter, 3)
            findings = [f for f in findings if SEVERITY_ORDER.get(f.severity, 3) <= min_severity]

        # Sort by severity (critical first), then file, then line
        findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.severity, 99), f.file, f.line))

        # Deduplicate (same rule + file + line)
        seen = set()
        deduped = []
        for f in findings:
            key = (f.rule, f.file, f.line)
            if key not in seen:
                seen.add(key)
                deduped.append(f)

        summary = {
            "total": len(deduped),
            "critical": sum(1 for f in deduped if f.severity == "critical"),
            "high": sum(1 for f in deduped if f.severity == "high"),
            "medium": sum(1 for f in deduped if f.severity == "medium"),
            "low": sum(1 for f in deduped if f.severity == "low"),
            "files_scanned": self.files_scanned,
        }

        return {
            "findings": [f.to_dict() for f in deduped],
            "summary": summary,
        }


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------

def discover_files(path: str) -> list[str]:
    """Find all scannable files under the given path."""
    target = Path(path)
    if target.is_file():
        if target.suffix.lower() in SCANNABLE_EXTENSIONS:
            return [str(target)]
        return []

    files = []
    for ext in SCANNABLE_EXTENSIONS:
        files.extend(str(p) for p in target.rglob(f"*{ext}"))

    # Exclude common non-project directories
    exclude_dirs = {"node_modules", ".next", "dist", "build", ".git", "vendor", "__pycache__"}
    filtered = []
    for f in files:
        parts = Path(f).parts
        if not any(d in exclude_dirs for d in parts):
            filtered.append(f)

    return sorted(filtered)


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def format_pretty(results: dict[str, Any]) -> str:
    """Human-readable output."""
    lines = []
    summary = results["summary"]

    lines.append("")
    lines.append("=" * 60)
    lines.append("  DESIGN ANTI-PATTERN DETECTOR")
    lines.append("=" * 60)
    lines.append("")

    if not results["findings"]:
        lines.append("  No findings. Clean!")
        lines.append("")
    else:
        current_severity = None
        for f in results["findings"]:
            if f["severity"] != current_severity:
                current_severity = f["severity"]
                lines.append(f"  [{current_severity.upper()}]")
                lines.append("  " + "-" * 40)

            loc = f"{f['file']}:{f['line']}"
            lines.append(f"  {f['rule']}")
            lines.append(f"    Location: {loc}")
            lines.append(f"    Evidence: {f['evidence']}")
            lines.append(f"    Fix: {f['suggestion']}")
            lines.append("")

    lines.append("-" * 60)
    lines.append(f"  Files scanned: {summary['files_scanned']}")
    lines.append(f"  Total findings: {summary['total']}")
    if summary["total"] > 0:
        parts = []
        for sev in ("critical", "high", "medium", "low"):
            count = summary[sev]
            if count > 0:
                parts.append(f"{count} {sev}")
        lines.append(f"  Breakdown: {', '.join(parts)}")
    lines.append("=" * 60)
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan HTML/JSX/TSX/CSS files for design anti-patterns.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "path",
        help="File or directory to scan",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        default=True,
        dest="output_json",
        help="Output as JSON (default)",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        default=False,
        help="Human-readable output",
    )
    parser.add_argument(
        "--severity",
        choices=["critical", "high", "medium", "low"],
        default=None,
        help="Minimum severity to report (e.g., --severity high shows high + critical)",
    )

    args = parser.parse_args()

    target = Path(args.path)
    if not target.exists():
        print(json.dumps({"error": f"Path not found: {args.path}"}), file=sys.stderr)
        return 1

    files = discover_files(args.path)
    if not files:
        print(json.dumps({"error": f"No scannable files found at: {args.path}"}), file=sys.stderr)
        return 1

    engine = RuleEngine()
    for filepath in files:
        engine.scan_file(filepath)

    results = engine.get_results(severity_filter=args.severity)

    if args.pretty:
        print(format_pretty(results))
    else:
        print(json.dumps(results, indent=2))

    # Exit code: 0 = clean, 2 = findings detected
    return 2 if results["summary"]["total"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())

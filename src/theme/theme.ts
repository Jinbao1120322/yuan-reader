import { ThemeKey } from '../store/useStore';

export interface ReaderTheme {
  bg: string;
  text: string;
  sub: string;
  barBg: string;
  barText: string;
}

export const READER_THEMES: Record<ThemeKey, ReaderTheme> = {
  day: {
    bg: '#f5f1e8',
    text: '#2b2b2b',
    sub: '#8a8275',
    barBg: '#ece6d8',
    barText: '#2b2b2b',
  },
  night: {
    bg: '#121212',
    text: '#b8b8b8',
    sub: '#666666',
    barBg: '#1c1c1c',
    barText: '#b8b8b8',
  },
  green: {
    bg: '#c7edcc',
    text: '#223322',
    sub: '#5a7a5a',
    barBg: '#b8e0bd',
    barText: '#223322',
  },
  paper: {
    bg: '#faf3e0',
    text: '#3a3026',
    sub: '#9b8c70',
    barBg: '#f0e6cf',
    barText: '#3a3026',
  },
};

// App 整体用色（深色风，契合系统夜色，且顶部中央留空避让灵动岛）
export const APP = {
  bg: '#0f0f12',
  card: '#1b1b20',
  card2: '#232329',
  text: '#ececf1',
  sub: '#8a8a93',
  accent: '#e0563f', // 暖橙红，呼应书封暖色
  border: '#2a2a31',
  danger: '#cf4b4b',
};

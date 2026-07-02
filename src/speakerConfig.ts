export type Speaker = {
  label: string;
  group: 'front' | 'side' | 'rear' | 'top' | 'lfe';
  area: string;
};

export const speakers: Speaker[] = [
  { label: 'L',   group: 'front', area: 'left' },
  { label: 'C',   group: 'front', area: 'center' },
  { label: 'R',   group: 'front', area: 'right' },
  { label: 'LFE', group: 'lfe',   area: 'lfe' },
  { label: 'Ls',  group: 'side',  area: 'leftSide' },
  { label: 'Rs',  group: 'side',  area: 'rightSide' },
  { label: 'Lrs', group: 'rear',  area: 'leftRear' },
  { label: 'Rrs', group: 'rear',  area: 'rightRear' },
  { label: 'Ltf', group: 'top',   area: 'leftTopFront' },
  { label: 'Rtf', group: 'top',   area: 'rightTopFront' },
  { label: 'Ltr', group: 'top',   area: 'leftTopRear' },
  { label: 'Rtr', group: 'top',   area: 'rightTopRear' },
];

// Backend buffer/meter channel order (matches atmos_wrapper.m labels12) — differs from `speakers` display order
export const channelOrder = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lrs', 'Rrs', 'Ltf', 'Rtf', 'Ltr', 'Rtr'];

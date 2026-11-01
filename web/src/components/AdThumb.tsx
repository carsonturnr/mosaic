import { Image, Play } from 'lucide-react'

/** Creative thumbnail, or a quiet placeholder when there is no stored media. */
export function AdThumb({ src, video, className = '' }: { src: string | undefined; video: boolean; className?: string }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-[#1d1838] to-[#2c2552] ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        : video ? <Play size={14} className="text-white/50" /> : <Image size={14} className="text-white/50" />}
    </span>
  )
}

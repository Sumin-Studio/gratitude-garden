import { createRoot } from 'react-dom/client'
import { Pad } from './Pad'
import { startGlass } from '../ui/glass'
import '../ui/panel.css'
import '../ui/sheet.css'
import '../board/board.css'
import './pad.css'

// The glass dials, moved in the garden's Fine tune, show here as they move.
startGlass()

createRoot(document.getElementById('root')!).render(<Pad />)

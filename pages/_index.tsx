import React, { useEffect, useMemo, useState } from "react";
import { FileDropzone } from "../components/FileDropzone";
import { Button } from "../components/Button";
import { ThemeModeSwitch } from "../components/ThemeModeSwitch";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { FileText, ShieldCheck, Zap, ArrowDownToLine, RefreshCw, CheckCircle2, AlertCircle, LockKeyhole, Gauge, ScanLine, Image as ImageIcon, FileArchive, RotateCw, Scissors, Hash, Combine, Split, Trash2, ArrowUpDown } from "lucide-react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

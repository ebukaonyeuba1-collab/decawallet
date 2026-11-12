"use client";
import { Printer } from "lucide-react";
import { Button } from "./ui";
export const PrintButton = () => <Button variant="outline" className="no-print" onClick={() => window.print()}><Printer className="size-5" aria-hidden />Print or save as PDF</Button>;

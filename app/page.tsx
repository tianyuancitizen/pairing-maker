"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { Upload, Download, Users, Clock, Clipboard, UserCheck, Calendar } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

interface MarketData {
  market: string
  hourlyVolumes: { [hour: string]: number }
}

interface PersonAssignment {
  person: number
  markets: string[]
  totalVolume: number
}

interface HourlyAssignments {
  [hour: string]: {
    [teamSize: number]: PersonAssignment[]
  }
}

export default function PairingMaker() {
  const [csvData, setCsvData] = useState<MarketData[]>([])
  const [assignments, setAssignments] = useState<HourlyAssignments>({})
  const [hours, setHours] = useState<string[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [shiftData, setShiftData] = useState<{ [person: string]: { [dayHour: string]: boolean } }>({})
  const [availablePeople, setAvailablePeople] = useState<string[]>([])
  const [finalAssignments, setFinalAssignments] = useState<{
    [hour: string]: { [teamSize: number]: { person: string; markets: string[]; totalVolume: number }[] }
  }>({})
  const [sheetsUrl, setSheetsUrl] = useState("")
  const [isLoadingSheets, setIsLoadingSheets] = useState(false)

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      parseCSV(text)
    }
    reader.readAsText(file)
  }, [])

  const parseCSV = (text: string) => {
    const lines = text.trim().split("\n")
    const headers = lines[0].split(",").map((h) => h.trim())
    const hourColumns = headers.slice(1) // First column is market name

    const data: MarketData[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())
      const market = values[0]
      const hourlyVolumes: { [hour: string]: number } = {}

      for (let j = 1; j < values.length; j++) {
        const volume = Number.parseFloat(values[j]) || 0
        hourlyVolumes[hourColumns[j - 1]] = volume
      }

      data.push({ market, hourlyVolumes })
    }

    setCsvData(data)
    setHours(hourColumns)
  }

  const optimizeAssignments = () => {
    if (csvData.length === 0 || hours.length === 0) return

    setIsProcessing(true)

    const newAssignments: HourlyAssignments = {}
    const teamSizes = [3, 4, 5, 6, 7, 8]

    // Store previous assignments for stability optimization
    const previousAssignments: { [teamSize: number]: PersonAssignment[] } = {}

    hours.forEach((hour, hourIndex) => {
      newAssignments[hour] = {}

      teamSizes.forEach((teamSize) => {
        // Get market volumes for this specific hour
        const marketVolumes = csvData
          .map((data) => ({
            market: data.market,
            volume: data.hourlyVolumes[hour] || 0,
          }))
          .sort((a, b) => b.volume - a.volume) // Sort by volume descending

        // Initialize people/teams
        const people: PersonAssignment[] = Array.from({ length: teamSize }, (_, i) => ({
          person: i + 1,
          markets: [],
          totalVolume: 0,
        }))

        // If this is not the first hour, try to maintain previous assignments for stability
        if (hourIndex > 0 && previousAssignments[teamSize]) {
          const unassignedMarkets = [...marketVolumes]
          const prevAssignments = previousAssignments[teamSize]

          // First pass: try to keep markets with the same person as previous hour
          prevAssignments.forEach((prevPerson, personIndex) => {
            if (personIndex < people.length) {
              prevPerson.markets.forEach((market) => {
                const marketIndex = unassignedMarkets.findIndex((m) => m.market === market)
                if (marketIndex !== -1) {
                  const marketData = unassignedMarkets[marketIndex]
                  people[personIndex].markets.push(market)
                  people[personIndex].totalVolume += marketData.volume
                  unassignedMarkets.splice(marketIndex, 1)
                }
              })
            }
          })

          // Second pass: distribute remaining markets to balance volumes
          unassignedMarkets.forEach((marketData) => {
            // Find person with lowest total volume
            const targetPerson = people.reduce(
              (min, person, index) => (person.totalVolume < people[min].totalVolume ? index : min),
              0,
            )

            people[targetPerson].markets.push(marketData.market)
            people[targetPerson].totalVolume += marketData.volume
          })

          // Third pass: rebalance if variance is too high (>25%)
          const volumes = people.map((p) => p.totalVolume)
          const avg = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length
          const max = Math.max(...volumes)
          const min = Math.min(...volumes)
          const variance = ((max - min) / avg) * 100

          if (variance > 25) {
            // Reset and redistribute more aggressively for better balance
            people.forEach((p) => {
              p.markets = []
              p.totalVolume = 0
            })

            marketVolumes.forEach((marketData) => {
              const targetPerson = people.reduce(
                (min, person, index) => (person.totalVolume < people[min].totalVolume ? index : min),
                0,
              )
              people[targetPerson].markets.push(marketData.market)
              people[targetPerson].totalVolume += marketData.volume
            })
          }
        } else {
          // First hour: distribute markets purely by volume balancing
          marketVolumes.forEach((marketData) => {
            // Find person with lowest total volume
            const targetPerson = people.reduce(
              (min, person, index) => (person.totalVolume < people[min].totalVolume ? index : min),
              0,
            )

            people[targetPerson].markets.push(marketData.market)
            people[targetPerson].totalVolume += marketData.volume
          })
        }

        newAssignments[hour][teamSize] = people
        previousAssignments[teamSize] = people
      })
    })

    setAssignments(newAssignments)
    setIsProcessing(false)
  }

  const exportResults = () => {
    if (Object.keys(assignments).length === 0) return

    let csvContent = "Hour,Team Size,Person,Markets,Total Volume\n"

    Object.entries(assignments).forEach(([hour, teamSizeAssignments]) => {
      Object.entries(teamSizeAssignments).forEach(([teamSizeStr, people]) => {
        people.forEach((person) => {
          const marketsStr = [...person.markets].sort((a, b) => a.localeCompare(b)).join("; ")
          csvContent += `${hour},${teamSizeStr},Person ${person.person},"${marketsStr}",${person.totalVolume.toFixed(2)}\n`
        })
      })
    })

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `hourly-market-assignments.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const loadGoogleSheets = async () => {
    if (!sheetsUrl.trim()) return

    setIsLoadingSheets(true)

    try {
      let csvUrl = sheetsUrl

      // If it's a Google Sheets URL, convert to CSV export format
      if (sheetsUrl.includes("docs.google.com/spreadsheets")) {
        const sheetId = extractSheetId(sheetsUrl)
        csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
      }

      const response = await fetch(csvUrl)
      const csvText = await response.text()

      parseShiftData(csvText)
    } catch (error) {
      console.error("Error loading data:", error)
      alert("Error loading data. Make sure the URL is accessible.")
    }

    setIsLoadingSheets(false)
  }

  const extractSheetId = (url: string): string => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    return match ? match[1] : ""
  }

  const parseShiftData = (csvText: string) => {
    const lines = csvText.split("\n")
    const allRows = lines.map((line) => line.split(","))

    console.log("Parsing shift data...")
    console.log("Total rows:", allRows.length)

    // Find header row (row 10, but 0-indexed so row 9)
    if (allRows.length <= 9) {
      alert("CSV doesn't have enough rows. Expected header in row 10.")
      return
    }

    const headerRow = allRows[9] || []
    console.log("Header row:", headerRow)

    // Extract day/hour columns (skip first column which is names)
    const dayHourColumns = headerRow
      .slice(1)
      .map((col) => col.trim())
      .filter((col) => col)

    console.log("Day/Hour columns found:", dayHourColumns.length)
    console.log("First few columns:", dayHourColumns.slice(0, 5))

    const shifts: { [person: string]: { [dayHour: string]: boolean } } = {}
    const people: string[] = []

    // Parse data starting from row 11 (0-indexed row 10)
    for (let i = 10; i < allRows.length; i++) {
      const row = allRows[i] || []
      const personName = row[0]?.trim()

      if (!personName || personName === "") continue

      console.log(`Processing person: ${personName}`)
      people.push(personName)
      shifts[personName] = {}

      // Check each day/hour column
      dayHourColumns.forEach((dayHour, colIndex) => {
        const cellValue = row[colIndex + 1]?.trim() || ""
        const isWorking = cellValue === "1"
        shifts[personName][dayHour] = isWorking

        if (isWorking) {
          console.log(`  ${personName} works during: ${dayHour}`)
        }
      })
    }

    console.log(`Found ${people.length} people with shift data`)
    console.log("People:", people)

    setShiftData(shifts)
    setAvailablePeople(people)
  }

  const assignPeopleToMarkets = () => {
    if (Object.keys(assignments).length === 0 || Object.keys(shiftData).length === 0) return

    console.log("Assigning people to markets...")
    console.log("Available people:", availablePeople)
    console.log("Hours to assign:", hours)

    const newFinalAssignments: typeof finalAssignments = {}

    Object.entries(assignments).forEach(([hour, teamSizeAssignments]) => {
      newFinalAssignments[hour] = {}

      Object.entries(teamSizeAssignments).forEach(([teamSizeStr, marketAssignments]) => {
        const teamSize = Number.parseInt(teamSizeStr)

        console.log(`\nProcessing hour ${hour}, team size ${teamSize}`)

        // Find people available for this hour
        const availableForHour = availablePeople.filter((person) => {
          const personShifts = shiftData[person] || {}
          const dayHourKeys = Object.keys(personShifts)

          // Look for any shift that matches this hour
          const isAvailable = dayHourKeys.some((dayHour) => {
            // Try different matching strategies
            const hourMatches =
              dayHour.includes(hour) || // Direct hour match
              dayHour.toLowerCase().includes(hour.toLowerCase()) || // Case insensitive
              hour.includes(dayHour) // Reverse match

            const isWorking = personShifts[dayHour]

            if (hourMatches && isWorking) {
              console.log(`  ${person} available: ${dayHour} matches ${hour}`)
              return true
            }
            return false
          })

          return isAvailable
        })

        console.log(`  Available people for ${hour}:`, availableForHour)

        if (availableForHour.length >= teamSize) {
          // Assign first available people to the market assignments
          const peopleAssignments = marketAssignments.slice(0, teamSize).map((assignment, index) => ({
            person: availableForHour[index] || `Person ${index + 1}`,
            markets: assignment.markets,
            totalVolume: assignment.totalVolume,
          }))

          newFinalAssignments[hour][teamSize] = peopleAssignments
          console.log(`  ✓ Assigned ${peopleAssignments.length} people`)
        } else {
          // Not enough people available, use available people + placeholders
          const peopleAssignments = marketAssignments.map((assignment, index) => ({
            person: availableForHour[index] || `[Need Person ${index + 1}]`,
            markets: assignment.markets,
            totalVolume: assignment.totalVolume,
          }))

          newFinalAssignments[hour][teamSize] = peopleAssignments
          console.log(`  ⚠ Only ${availableForHour.length}/${teamSize} people available`)
        }
      })
    })

    setFinalAssignments(newFinalAssignments)
    console.log("Final assignments created:", Object.keys(newFinalAssignments).length, "hours")
  }

  const exportFinalResults = () => {
    if (Object.keys(finalAssignments).length === 0) return

    let csvContent = "Hour,Team Size,Person Name,Markets,Total Volume,Available\n"

    Object.entries(finalAssignments).forEach(([hour, teamSizeAssignments]) => {
      Object.entries(teamSizeAssignments).forEach(([teamSizeStr, people]) => {
        people.forEach((person) => {
          const marketsStr = [...person.markets].sort((a, b) => a.localeCompare(b)).join("; ")
          const isAvailable = !person.person.startsWith("[Need Person")
          csvContent += `${hour},${teamSizeStr},"${person.person}","${marketsStr}",${person.totalVolume.toFixed(2)},${isAvailable}\n`
        })
      })
    })

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `final-people-assignments.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const calculateVolumeStats = (people: PersonAssignment[]) => {
    const volumes = people.map((p) => p.totalVolume)
    const avg = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length
    const max = Math.max(...volumes)
    const min = Math.min(...volumes)
    const variance = avg > 0 ? (((max - min) / avg) * 100).toFixed(1) : "0.0"
    return { avg, max, min, variance }
  }

  const calculateStabilityScore = (hour: string, teamSize: number) => {
    const hourIndex = hours.indexOf(hour)
    if (hourIndex === 0) return "N/A" // First hour has no previous to compare

    const currentAssignments = assignments[hour]?.[teamSize] || []
    const prevHour = hours[hourIndex - 1]
    const prevAssignments = assignments[prevHour]?.[teamSize] || []

    if (currentAssignments.length === 0 || prevAssignments.length === 0) return "N/A"

    let stableAssignments = 0
    let totalAssignments = 0

    currentAssignments.forEach((currentPerson, personIndex) => {
      if (prevAssignments[personIndex]) {
        currentPerson.markets.forEach((market) => {
          totalAssignments++
          if (prevAssignments[personIndex].markets.includes(market)) {
            stableAssignments++
          }
        })
      }
    })

    return totalAssignments > 0 ? `${((stableAssignments / totalAssignments) * 100).toFixed(0)}%` : "N/A"
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Breakdown Pairing Maker</h1>
        <p className="text-muted-foreground">
          Hourly market distribution optimized for equitable clip volume across team sizes 3-8
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Step 1: Upload Market Volume Data
          </CardTitle>
          <CardDescription>
            Upload a CSV file with markets as rows and hours (EST) as columns. Values should be average clip volumes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="csvFile">CSV File</Label>
            <Input id="csvFile" type="file" accept=".csv" onChange={handleFileUpload} />
          </div>

          {csvData.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge variant="secondary">{csvData.length} markets loaded</Badge>
                <Badge variant="secondary">{hours.length} hours</Badge>
              </div>

              <Button onClick={optimizeAssignments} disabled={isProcessing} className="w-full">
                <Users className="w-4 h-4 mr-2" />
                {isProcessing ? "Processing All Hours & Team Sizes..." : "Generate Hourly Assignments"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {csvData.length > 0 && Object.keys(assignments).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Step 2: Load Shift Schedule
            </CardTitle>
            <CardDescription>
              Paste the CSV URL or Google Sheets link. Expected format: Row 10 = headers, Column A = people names
              (starting row 11), values = "1" for working shifts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sheetsUrl">CSV URL or Google Sheets Link</Label>
              <Textarea
                id="sheetsUrl"
                placeholder="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/master%20v2%20test-SSUuyP7Ti2zy8qBbv5eWb5fIWWXHoY.csv"
                value={sheetsUrl}
                onChange={(e) => setSheetsUrl(e.target.value)}
                rows={3}
              />
            </div>

            <Button onClick={loadGoogleSheets} disabled={isLoadingSheets || !sheetsUrl.trim()}>
              <Clipboard className="w-4 h-4 mr-2" />
              {isLoadingSheets ? "Loading..." : "Load Shift Data"}
            </Button>

            {availablePeople.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Badge variant="secondary">{availablePeople.length} people loaded</Badge>
                  <Badge variant="secondary">
                    {Object.keys(shiftData[availablePeople[0]] || {}).length} time slots
                  </Badge>
                </div>

                <div className="text-sm text-muted-foreground">
                  <strong>People found:</strong> {availablePeople.slice(0, 5).join(", ")}
                  {availablePeople.length > 5 && ` and ${availablePeople.length - 5} more...`}
                </div>

                <Button onClick={assignPeopleToMarkets} className="w-full">
                  <UserCheck className="w-4 h-4 mr-2" />
                  Assign People to Markets
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {Object.keys(assignments).length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Hourly Market Assignments
                </CardTitle>
                <CardDescription>
                  Dynamic assignments optimized for each hour's clip volume across all team sizes
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={exportResults} variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export Market Data
                </Button>
                {Object.keys(finalAssignments).length > 0 && (
                  <Button onClick={exportFinalResults} variant="outline">
                    <Download className="w-4 h-4 mr-2" />
                    Export People Assignments
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={hours[0]} className="w-full">
              <TabsList className="grid w-full grid-cols-6 lg:grid-cols-12">
                {hours.slice(0, 12).map((hour) => (
                  <TabsTrigger key={hour} value={hour} className="text-xs">
                    {hour}
                  </TabsTrigger>
                ))}
              </TabsList>

              {hours.slice(0, 12).map((hour) => (
                <TabsContent key={hour} value={hour} className="space-y-4">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold">Hour: {hour}</h3>
                    <p className="text-sm text-muted-foreground">
                      Market assignments for all team sizes based on this hour's clip volumes
                    </p>
                  </div>

                  <Tabs defaultValue="3" className="w-full">
                    <TabsList className="grid w-full grid-cols-6">
                      {[3, 4, 5, 6, 7, 8].map((size) => (
                        <TabsTrigger key={size} value={size.toString()}>
                          {size} People
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {[3, 4, 5, 6, 7, 8].map((teamSize) => {
                      const people = assignments[hour]?.[teamSize] || []
                      const stats = calculateVolumeStats(people)
                      const stability = calculateStabilityScore(hour, teamSize)

                      return (
                        <TabsContent key={teamSize} value={teamSize.toString()} className="space-y-4">
                          <div className="grid grid-cols-5 gap-4 text-sm">
                            <div className="text-center">
                              <div className="font-medium">Avg Volume</div>
                              <div className="text-muted-foreground">{stats.avg.toFixed(1)}</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium">Max Volume</div>
                              <div className="text-muted-foreground">{stats.max.toFixed(1)}</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium">Min Volume</div>
                              <div className="text-muted-foreground">{stats.min.toFixed(1)}</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium">Variance</div>
                              <div className="text-muted-foreground">{stats.variance}%</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium">Stability</div>
                              <div className="text-muted-foreground">{stability}</div>
                            </div>
                          </div>

                          <Separator />

                          <div className="grid gap-4">
                            {(Object.keys(finalAssignments).length > 0 && finalAssignments[hour]?.[teamSize]
                              ? finalAssignments[hour][teamSize]
                              : people
                            ).map((assignment, index) => {
                              const isPersonAssignment = "person" in assignment
                              const displayName = isPersonAssignment
                                ? String(assignment.person)
                                : `Person ${assignment.person}`
                              const markets = assignment.markets
                              const volume = assignment.totalVolume
                              const needsPerson = displayName.startsWith("[Need Person")

                              return (
                                <Card key={index}>
                                  <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className={`text-lg ${needsPerson ? "text-red-600" : ""}`}>
                                        {displayName}
                                      </CardTitle>
                                      <Badge variant="outline">Volume: {volume.toFixed(1)}</Badge>
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="flex flex-wrap gap-2">
                                      {[...markets].sort((a, b) => a.localeCompare(b)).map((market) => (
                                        <Badge key={market} variant="secondary">
                                          {market}
                                        </Badge>
                                      ))}
                                    </div>
                                  </CardContent>
                                </Card>
                              )
                            })}
                          </div>
                        </TabsContent>
                      )
                    })}
                  </Tabs>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

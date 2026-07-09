// A tiny in-memory data layer shared by the agent's tools and schedule.
//
// On Vercel, an eve agent would persist state through Vercel Workflows and the
// sandbox. For a local Watt demo this module keeps listings seeded in memory and
// accumulates booked viewings for the life of the process — enough to exercise
// the tools and the daily digest without an external database.

export interface Listing {
  id: string
  address: string
  neighborhood: string
  priceUSD: number
  beds: number
  baths: number
  sqft: number
  type: 'condo' | 'house' | 'townhouse' | 'loft'
  summary: string
}

export interface Viewing {
  id: string
  listingId: string
  clientName: string
  clientEmail: string
  date: string // YYYY-MM-DD
  time: string // HH:mm, 24h
  notes?: string
}

const listings: Listing[] = [
  {
    id: 'L-101',
    address: '112 Prospect Park West, Apt 4B',
    neighborhood: 'Park Slope',
    priceUSD: 1_250_000,
    beds: 2,
    baths: 2,
    sqft: 1100,
    type: 'condo',
    summary: 'Sunny top-floor 2-bed with park views and a renovated kitchen.'
  },
  {
    id: 'L-102',
    address: '48 Bergen Street',
    neighborhood: 'Boerum Hill',
    priceUSD: 2_400_000,
    beds: 4,
    baths: 3,
    sqft: 2200,
    type: 'townhouse',
    summary: 'Restored 1890s brownstone with original details and a south-facing garden.'
  },
  {
    id: 'L-103',
    address: '300 Kent Avenue, Unit 902',
    neighborhood: 'Williamsburg',
    priceUSD: 1_695_000,
    beds: 2,
    baths: 2,
    sqft: 1250,
    type: 'loft',
    summary: 'Waterfront loft with floor-to-ceiling windows and Manhattan skyline views.'
  },
  {
    id: 'L-104',
    address: '77 Clinton Avenue',
    neighborhood: 'Clinton Hill',
    priceUSD: 985_000,
    beds: 1,
    baths: 1,
    sqft: 780,
    type: 'condo',
    summary: 'Quiet one-bed in a boutique elevator building, low common charges.'
  },
  {
    id: 'L-105',
    address: '210 Berkeley Place',
    neighborhood: 'Park Slope',
    priceUSD: 3_150_000,
    beds: 5,
    baths: 4,
    sqft: 3000,
    type: 'house',
    summary: 'Wide single-family home a block from the park, chef’s kitchen, finished cellar.'
  },
  {
    id: 'L-106',
    address: '155 Java Street, Apt 2R',
    neighborhood: 'Greenpoint',
    priceUSD: 875_000,
    beds: 1,
    baths: 1,
    sqft: 720,
    type: 'condo',
    summary: 'Bright starter condo with a private balcony, close to the ferry.'
  }
]

const viewings: Viewing[] = []

export interface ListingQuery {
  neighborhood?: string
  maxPriceUSD?: number
  minBeds?: number
  type?: Listing['type']
}

export function searchListings (query: ListingQuery = {}): Listing[] {
  return listings.filter(listing => {
    if (query.neighborhood && !listing.neighborhood.toLowerCase().includes(query.neighborhood.toLowerCase())) {
      return false
    }
    if (typeof query.maxPriceUSD === 'number' && listing.priceUSD > query.maxPriceUSD) {
      return false
    }
    if (typeof query.minBeds === 'number' && listing.beds < query.minBeds) {
      return false
    }
    if (query.type && listing.type !== query.type) {
      return false
    }
    return true
  })
}

export function getListing (id: string): Listing | undefined {
  return listings.find(listing => listing.id.toLowerCase() === id.toLowerCase())
}

export interface BookViewingInput {
  listingId: string
  clientName: string
  clientEmail: string
  date: string
  time: string
  notes?: string
}

export function bookViewing (input: BookViewingInput): Viewing {
  const listing = getListing(input.listingId)
  if (!listing) {
    throw new Error(`No listing with id "${input.listingId}".`)
  }

  const viewing: Viewing = {
    id: `V-${(viewings.length + 1).toString().padStart(4, '0')}`,
    listingId: listing.id,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    date: input.date,
    time: input.time,
    notes: input.notes
  }

  viewings.push(viewing)
  return viewing
}

export interface ViewingQuery {
  date?: string
  clientEmail?: string
}

export function listViewings (query: ViewingQuery = {}): Viewing[] {
  return viewings
    .filter(viewing => {
      if (query.date && viewing.date !== query.date) {
        return false
      }
      if (query.clientEmail && viewing.clientEmail.toLowerCase() !== query.clientEmail.toLowerCase()) {
        return false
      }
      return true
    })
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
}

/** Today's date as YYYY-MM-DD in the server's local timezone. */
export function todayISODate (): string {
  return new Date().toISOString().slice(0, 10)
}

// Seed a couple of viewings for *today* so the digest and schedule have
// something to show on a fresh start.
const today = todayISODate()
bookViewing({
  listingId: 'L-101',
  clientName: 'Dana Whitfield',
  clientEmail: 'dana@example.com',
  date: today,
  time: '11:00',
  notes: 'Second visit — bringing a contractor.'
})
bookViewing({
  listingId: 'L-103',
  clientName: 'Marcus Lee',
  clientEmail: 'marcus@example.com',
  date: today,
  time: '15:30'
})

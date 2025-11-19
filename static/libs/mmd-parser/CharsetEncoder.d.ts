/**
 * Simple CharsetEncoder for Shift_JIS
 */
export declare class CharsetEncoder {
    private constructor();
    /**
     * Converts from Shift_JIS Uint8Array data to Unicode strings.
     * @param uint8Array Shift_JIS Uint8Array data.
     * @returns Unicode strings.
     */
    static s2u(uint8Array: Uint8Array): string;
    /**
     * Readonly Shift_JIS to Unicode table.
     */
    static readonly s2uTable: Readonly<{
        [key: number]: number;
    }>;
}

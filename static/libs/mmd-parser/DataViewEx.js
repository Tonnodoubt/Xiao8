import { CharsetEncoder } from "./CharsetEncoder.js";
export class DataViewEx {
    littleEndian;
    _offset;
    _dv;
    constructor(buffer, littleEndian = true) {
        this._dv = new DataView(buffer);
        this._offset = 0;
        this.littleEndian = (littleEndian !== undefined) ? littleEndian : true;
    }
    get offset() {
        return this._offset;
    }
    getInt8() {
        const value = this._dv.getInt8(this._offset);
        this._offset += 1;
        return value;
    }
    getInt8Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getInt8());
        }
        return a;
    }
    getUint8() {
        const value = this._dv.getUint8(this._offset);
        this._offset += 1;
        return value;
    }
    getUint8Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getUint8());
        }
        return a;
    }
    getInt16() {
        const value = this._dv.getInt16(this._offset, this.littleEndian);
        this._offset += 2;
        return value;
    }
    getInt16Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getInt16());
        }
        return a;
    }
    getUint16() {
        const value = this._dv.getUint16(this._offset, this.littleEndian);
        this._offset += 2;
        return value;
    }
    getUint16Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getUint16());
        }
        return a;
    }
    getInt32() {
        const value = this._dv.getInt32(this._offset, this.littleEndian);
        this._offset += 4;
        return value;
    }
    getInt32Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getInt32());
        }
        return a;
    }
    getUint32() {
        const value = this._dv.getUint32(this._offset, this.littleEndian);
        this._offset += 4;
        return value;
    }
    getUint32Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getUint32());
        }
        return a;
    }
    getFloat32() {
        const value = this._dv.getFloat32(this._offset, this.littleEndian);
        this._offset += 4;
        return value;
    }
    getFloat32Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getFloat32());
        }
        return a;
    }
    getFloat64() {
        const value = this._dv.getFloat64(this._offset, this.littleEndian);
        this._offset += 8;
        return value;
    }
    getFloat64Array(size) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getFloat64());
        }
        return a;
    }
    getIndex(type, isUnsigned) {
        switch (type) {
            case 1:
                return (isUnsigned === true) ? this.getUint8() : this.getInt8();
            case 2:
                return (isUnsigned === true) ? this.getUint16() : this.getInt16();
            case 4:
                return this.getInt32(); // No Uint32
            default:
                throw "unknown number type " + type + " exception.";
        }
    }
    getIndexArray(type, size, isUnsigned) {
        const a = [];
        for (let i = 0; i < size; i++) {
            a.push(this.getIndex(type, isUnsigned));
        }
        return a;
    }
    getChars(size) {
        let str = "";
        while (size > 0) {
            const value = this.getUint8();
            size--;
            if (value === 0)
                break;
            str += String.fromCharCode(value);
        }
        while (size > 0) {
            this.getUint8();
            size--;
        }
        return str;
    }
    getSjisStringsAsUnicode(size) {
        const a = [];
        while (size > 0) {
            const value = this.getUint8();
            size--;
            if (value === 0)
                break;
            a.push(value);
        }
        while (size > 0) {
            this.getUint8();
            size--;
        }
        return CharsetEncoder.s2u(new Uint8Array(a));
    }
    getUnicodeStrings(size) {
        let str = "";
        while (size > 0) {
            const value = this.getUint16();
            size -= 2;
            if (value === 0)
                break;
            str += String.fromCharCode(value);
        }
        while (size > 0) {
            this.getUint8();
            size--;
        }
        return str;
    }
    getTextBuffer() {
        const size = this.getUint32();
        return this.getUnicodeStrings(size);
    }
}

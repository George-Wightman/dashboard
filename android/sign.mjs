#!/usr/bin/env node
// Signs the widgets app on the laptop and puts it in Google Drive for the phone (android/README.md):
//   node android/sign.mjs
// The first time it sets itself up in ~/.dashboard-android (outside Drive, so the key never syncs):
// a JDK (Eclipse Temurin 17), Google's apksig library, and a signing key with a random password.
// Then: the latest unsigned build from the android-builds branch, signed, checked, and copied to
// My Drive/Dashboard widgets/. Never prints the password.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HOME = join(homedir(), '.dashboard-android');
const JDK_URL = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse';
const APKSIG = '8.5.2';
const APKSIG_URL = `https://dl.google.com/android/maven2/com/android/tools/build/apksig/${APKSIG}/apksig-${APKSIG}.jar`;
const BUILDS = 'https://raw.githubusercontent.com/George-Wightman/dashboard/android-builds';
const DRIVE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Dashboard widgets');
const WINDOWS_TAR = 'C:\\Windows\\System32\\tar.exe';

async function download(url, to) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Couldn't download ${url} (${res.status})`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

async function jdk() {
  const dir = join(HOME, 'jdk');
  const find = () => (existsSync(dir) ? readdirSync(dir).map((d) => join(dir, d, 'bin')).find((b) => existsSync(join(b, 'java.exe'))) : null);
  if (find()) return find();
  mkdirSync(dir, { recursive: true });
  console.log('Setting up: downloading a JDK (Eclipse Temurin 17, about 190 MB)…');
  const zip = join(HOME, 'jdk.zip');
  await download(JDK_URL, zip);
  execFileSync(WINDOWS_TAR, ['-xf', zip, '-C', dir]);
  const bin = find();
  if (!bin) throw new Error('The JDK unpacked, but java.exe isn\'t where it should be');
  return bin;
}

async function apksig() {
  const jar = join(HOME, `apksig-${APKSIG}.jar`);
  if (!existsSync(jar)) await download(APKSIG_URL, jar);
  return jar;
}

function keystore(bin) {
  const file = join(HOME, 'widgets.p12');
  const secret = join(HOME, 'keystore.json');
  if (existsSync(file) && existsSync(secret)) return { file, password: JSON.parse(readFileSync(secret, 'utf8')).password };
  const password = randomBytes(24).toString('base64url');
  execFileSync(join(bin, 'keytool.exe'), ['-genkeypair', '-keystore', file, '-storetype', 'PKCS12', '-alias', 'widgets',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '36500', '-dname', 'CN=George Wightman, O=Dashboard widgets',
    '-storepass', password, '-keypass', password], { stdio: 'ignore' });
  writeFileSync(secret, JSON.stringify({ password }));
  console.log(`Made a signing key in ${file}. Keep this folder: a new key means uninstalling the app to update it.`);
  return { file, password };
}

const SIGNER = `
import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.List;

public class SignApk {
  public static void main(String[] a) throws Exception {
    char[] pass = System.getenv("WIDGETS_STOREPASS").toCharArray();
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (InputStream in = new FileInputStream(a[0])) { ks.load(in, pass); }
    PrivateKey key = (PrivateKey) ks.getKey("widgets", pass);
    X509Certificate cert = (X509Certificate) ks.getCertificate("widgets");
    ApkSigner.SignerConfig sc = new ApkSigner.SignerConfig.Builder("widgets", key, List.of(cert)).build();
    new ApkSigner.Builder(List.of(sc)).setInputApk(new File(a[1])).setOutputApk(new File(a[2]))
        .setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true).setMinSdkVersion(26).build().sign();
    ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[2])).build().verify();
    if (!r.isVerified()) { System.err.println("The signed app didn't verify: " + r.getErrors()); System.exit(1); }
    System.out.println("Signed and verified (v1 " + r.isVerifiedUsingV1Scheme() + ", v2 " + r.isVerifiedUsingV2Scheme() + ", v3 " + r.isVerifiedUsingV3Scheme() + ")");
  }
}
`;

mkdirSync(HOME, { recursive: true });
const bin = await jdk();
const jar = await apksig();
const ks = keystore(bin);
const build = (await (await fetch(`${BUILDS}/BUILD.txt?x=${Date.now()}`)).text()).trim();
if (!/ success$/.test(build)) throw new Error(`The latest build didn't pass: ${build}`);
const unsigned = join(HOME, 'app-release-unsigned.apk');
await download(`${BUILDS}/app-release-unsigned.apk?x=${Date.now()}`, unsigned);
const signer = join(HOME, 'SignApk.java');
writeFileSync(signer, SIGNER);
const signed = join(HOME, 'Dashboard widgets.apk');
const out = execFileSync(join(bin, 'java.exe'), ['-cp', jar, signer, ks.file, unsigned, signed], { env: { ...process.env, WIDGETS_STOREPASS: ks.password } });
process.stdout.write(out);
mkdirSync(DRIVE, { recursive: true });
copyFileSync(signed, join(DRIVE, 'Dashboard widgets.apk'));
console.log(`Build ${build.split(' ').slice(0, 3).join(' ')} → ${join(DRIVE, 'Dashboard widgets.apk')}`);

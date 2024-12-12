import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Commitment,
} from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import yargs from "yargs";
import reader from "readline-sync";

const COMMITMENT = "confirmed";

/**
 * 初始化 Anchor Program 實例
 * @param provider - Anchor Provider 物件，用於與 Solana 區塊鏈進行交互。
 * @param keypath - 本地密鑰文件的路徑，用於定位 Program 的公鑰。
 * @returns 初始化完成的 Anchor Program 實例。
 * @throws 如果密鑰文件無法讀取或 IDL 無法提取，則可能拋出錯誤。
 */
export async function myAnchorProgram(
  provider: anchor.Provider,
  keypath: string
): Promise<anchor.Program> {
  const myProgramKeypair = await sb.AnchorUtils.initKeypairFromFile(keypath);
  const pid = myProgramKeypair.publicKey;
  const idl = (await anchor.Program.fetchIdl(pid, provider))!;
  const program = new anchor.Program(idl, provider);
  return program;
}

/**
 * 加載 Smart Contract 的 Anchor Program 實例
 * @param provider - Anchor Provider 物件，用於連接 Solana 區塊鏈。
 * @returns 加載的 Anchor Program 實例，用於智能合約交互。
 * @throws 如果 Program ID 無法獲取或 IDL 提取失敗，則可能拋出錯誤。
 */
export async function loadSbProgram(
  provider: anchor.Provider
): Promise<anchor.Program> {
  const sbProgramId = await sb.getProgramId(provider.connection);
  const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
  const sbProgram = new anchor.Program(sbIdl!, provider);
  return sbProgram;
}

/**
 * 初始化 myAnchorProgram 的 Anchor 實例
 * @param provider - Anchor Provider 物件，用於與 Solana 區塊鏈交互。
 * @returns 已初始化的 Anchor Program 實例。
 * @throws 如果密鑰文件無法讀取或智能合約初始化失敗，可能會拋出錯誤。
 */
export async function initializeMyProgram(
  provider: anchor.Provider
): Promise<anchor.Program> {
  const myProgramPath =
    "sb-randomness/target/deploy/sb_randomness-keypair.json";
  const myProgram = await myAnchorProgram(provider, myProgramPath);
  console.log("My program", myProgram.programId.toString());
  return myProgram;
}

/**
 * 初始化並設置默認隊列賬戶
 * @param program - 已初始化的 Anchor Program 實例，用於智能合約交互。
 * @returns 隊列賬戶的公鑰（PublicKey）。
 * @throws 如果隊列賬戶不存在或無法加載，將終止程序執行。
 */
export async function setupQueue(program: anchor.Program): Promise<PublicKey> {
  const queueAccount = await sb.getDefaultQueue(
    program.provider.connection.rpcEndpoint
  );
  console.log("Queue account", queueAccount.pubkey.toString());
  try {
    await queueAccount.loadData();
  } catch (err) {
    console.error("Queue not found, ensure you are using devnet in your env");
    process.exit(1);
  }
  return queueAccount.pubkey;
}

/**
 * 從命令列或用戶輸入中獲取猜測結果。
 * @returns 布林值，`true` 表示 "heads" (正面)，`false` 表示 "tails" (反面)。
 * @throws 若輸入無效，函數將輸出錯誤消息並退出程序。
 */
export function getUserGuessFromCommandLine(): boolean {
  // Extract the user's guess from the command line arguments
  let userGuessInput = process.argv[2]; // The third argument is the user's input
  if (!userGuessInput) {
    userGuessInput = reader
      .question("It is now time to make your prediction: Heads or tails... ")
      .trim()
      .toLowerCase();
  }

  // Validate and convert the input to a boolean (heads = true, tails = false)
  const isValidGuess = userGuessInput === "heads" || userGuessInput === "tails";
  if (!isValidGuess) {
    console.error('Please provide a valid guess: "heads" or "tails".');
    process.exit(1); // Exit the script with an error code
  }

  return userGuessInput === "heads"; // Convert "heads" to true, "tails" to false
}

/**
 * Creates, simulates, sends, and confirms a transaction.
 * @param sbProgram - The Switchboard program.
 * @param connection - The Solana connection object.
 * @param ix - The instruction array for the transaction.
 * @param keypair - The keypair of the payer.
 * @param signers - The array of signers for the transaction.
 * @param txOpts - The transaction options.
 * @returns The transaction signature.
 */
export async function handleTransaction(
  sbProgram: anchor.Program,
  connection: Connection,
  ix: anchor.web3.TransactionInstruction[],
  keypair: Keypair,
  signers: Keypair[],
  txOpts: any
): Promise<string> {
  const createTx = await sb.asV0Tx({
    connection: sbProgram.provider.connection,
    ixs: ix,
    payer: keypair.publicKey,
    signers: signers,
    computeUnitPrice: 75_000,
    computeUnitLimitMultiple: 1.3,
  });

  const sim = await connection.simulateTransaction(createTx, txOpts);
  const sig = await connection.sendTransaction(createTx, txOpts);
  await connection.confirmTransaction(sig, COMMITMENT);
  console.log("  Transaction Signature", sig);
  return sig;
}

/**
 * 初始化遊戲，設置玩家狀態帳戶和保管帳戶等必要的狀態。
 * @param myProgram - 主要的 Anchor 程式物件，包含初始化邏輯。
 * @param playerStateAccount - 玩家狀態帳戶，包含公鑰和帳戶編號。
 * @param escrowAccount - 保管帳戶的公鑰，用於存儲資金等。
 * @param keypair - 用戶的密鑰對，用於簽名交易。
 * @param sbProgram - Switchboard program，通常用於額外的操作或處理。
 * @param connection - 與 Solana 網絡的連線物件。
 * @returns Void，該函數不返回任何值，僅執行初始化操作。
 * @throws 當交易執行失敗時，會拋出錯誤。
 */
export async function initializeGame(
  myProgram: anchor.Program,
  playerStateAccount: [anchor.web3.PublicKey, number],
  escrowAccount: PublicKey,
  keypair: Keypair,
  sbProgram: anchor.Program,
  connection: Connection
): Promise<void> {
  const initIx = await myProgram.methods
    .initialize()
    .accounts({
      playerState: playerStateAccount,
      escrowAccount: escrowAccount,
      user: keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const txOpts = {
    commitment: "processed" as Commitment,
    skipPreflight: true,
    maxRetries: 0,
  };
  await handleTransaction(
    sbProgram,
    connection,
    [initIx],
    keypair,
    [keypair],
    txOpts
  );
}

/**
 * 生成硬幣投擲（coin flip）交易指令。
 * @param myProgram - Anchor 程式物件，與 Solana 智能合約交互。
 * @param rngKpPublicKey - 隨機數數據帳戶的公鑰。
 * @param userGuess - 用戶的猜測（`true` = "heads"，`false` = "tails"）。
 * @param playerStateAccount - 玩家狀態帳戶及其 bump。
 * @param keypair - 用戶的密鑰對，包含公鑰和私鑰。
 * @param escrowAccount - 保管帳戶，用於存儲交易中的資金。
 * @returns 返回生成的交易指令。
 */
export async function createCoinFlipInstruction(
  myProgram: anchor.Program,
  rngKpPublicKey: PublicKey,
  userGuess: boolean,
  playerStateAccount: [anchor.web3.PublicKey, number],
  keypair: Keypair,
  escrowAccount: PublicKey
): Promise<anchor.web3.TransactionInstruction> {
  return await myProgram.methods
    .coinFlip(rngKpPublicKey, userGuess)
    .accounts({
      playerState: playerStateAccount,
      user: keypair.publicKey,
      randomnessAccountData: rngKpPublicKey,
      escrowAccount: escrowAccount,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * 生成用於结算 Flip 的交易指令。
 * @param myProgram - Anchor 程式物件，與 Solana 智能合約交互。
 * @param escrowBump - 用於生成 Escrow 帳戶的 bump 值，防止碰撞。
 * @param playerStateAccount - 玩家狀態帳戶與 bump。
 * @param rngKpPublicKey - 存儲隨機數數據的帳戶公鑰。
 * @param escrowAccount - 保管帳戶的公鑰，用來存儲交易中的資金。
 * @param keypair - 用戶的密鑰對，包含公鑰和私鑰，用於簽署交易。
 * @returns 返回結算翻轉的交易指令。
 */
export async function settleFlipInstruction(
  myProgram: anchor.Program,
  escrowBump: number,
  playerStateAccount: [anchor.web3.PublicKey, number],
  rngKpPublicKey: PublicKey,
  escrowAccount: PublicKey,
  keypair: Keypair
): Promise<anchor.web3.TransactionInstruction> {
  return await myProgram.methods
    .settleFlip(escrowBump)
    .accounts({
      playerState: playerStateAccount,
      randomnessAccountData: rngKpPublicKey,
      escrowAccount: escrowAccount,
      user: keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * 確保保管帳戶有足夠的資金以滿足租金豁免要求。
 * 如果餘額不足，會從指定的密鑰對資金轉入。
 * @param connection - 與 Solana 網絡的連接，用於查詢帳戶餘額和發送交易。
 * @param escrowAccount - 保管帳戶的公鑰，會檢查其餘額是否滿足最低租金豁免要求。
 * @param keypair - 用戶的密鑰對，用來簽署交易。
 * @param sbProgram - Anchor 程式物件，用於構建和發送交易。
 * @param txOpts - 交易選項，用來設置交易的承諾等級、跳過預檢查等。
 * @returns Void，該函數不會返回任何值，僅執行資金轉移操作。
 * @throws 當交易無法成功執行時，會拋出錯誤。
 */
export async function ensureEscrowFunded(
  connection: Connection,
  escrowAccount: PublicKey,
  keypair: Keypair,
  sbProgram: anchor.Program,
  txOpts: any
): Promise<void> {
  const accountBalance = await connection.getBalance(escrowAccount);
  const minRentExemption =
    await connection.getMinimumBalanceForRentExemption(0);

  const requiredBalance = minRentExemption;
  if (accountBalance < requiredBalance) {
    const amountToFund = requiredBalance - accountBalance;
    console.log(
      `Funding account with ${amountToFund} lamports to meet rent exemption threshold.`
    );

    const transferIx = SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: escrowAccount,
      lamports: amountToFund,
    });

    const transferTx = await sb.asV0Tx({
      connection: sbProgram.provider.connection,
      ixs: [transferIx],
      payer: keypair.publicKey,
      signers: [keypair],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const sim3 = await connection.simulateTransaction(transferTx, txOpts);
    const sig3 = await connection.sendTransaction(transferTx, txOpts);
    await connection.confirmTransaction(sig3, COMMITMENT);
    console.log("  Transaction Signature ", sig3);
  } else {
    console.log("  Escrow account funded already");
  }
}

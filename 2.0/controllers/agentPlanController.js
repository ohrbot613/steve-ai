const Plan = require("../modals/planModal");

const VALID_TRANSITIONS = {
  pending:   ["executing", "failed"],
  executing: ["paused", "completed", "failed"],
  paused:    ["executing", "failed"],
  completed: [],
  failed:    [],
};

function canTransition(fromStatus, toStatus) {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

exports.createPlan = async (req, res) => {
  try {
    const { userId, goal, steps } = req.body;
    console.log("[AgentPlan] createPlan", { userId, goal, stepsCount: steps?.length });

    if (!userId || !goal || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({
        success: false,
        error: "userId, goal, and a non-empty steps array are required",
      });
    }

    const plan = new Plan({
      userId,
      goal,
      steps: steps.map((desc, idx) => ({
        stepNumber: idx + 1,
        description: typeof desc === "string" ? desc : desc.description,
        status: "pending",
      })),
    });

    await plan.save();
    console.log("[AgentPlan] Plan created", { planId: plan._id, status: plan.status, stepsCount: plan.steps.length });

    return res.status(201).json({
      success: true,
      planId: plan._id,
      status: plan.status,
      stepsCount: plan.steps.length,
    });
  } catch (err) {
    console.error("[AgentPlan] createPlan error:", err.message);
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Invalid plan ID format",
      });
    }
    console.error("createPlan error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

exports.executePlan = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[AgentPlan] executePlan", { planId: id });

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: "Plan not found",
      });
    }

    if (!canTransition(plan.status, "executing")) {
      return res.status(409).json({
        success: false,
        error: `Cannot transition from '${plan.status}' to 'executing'`,
      });
    }

    plan.status = "executing";
    plan.startedAt = plan.startedAt || new Date();
    await plan.save();
    console.log("[AgentPlan] Plan executing", { planId: plan._id, startedAt: plan.startedAt });

    return res.status(200).json({
      success: true,
      planId: plan._id,
      status: plan.status,
      startedAt: plan.startedAt,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Invalid plan ID format",
      });
    }
    console.error("[AgentPlan] executePlan error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

exports.resumePlan = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[AgentPlan] resumePlan", { planId: id });

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: "Plan not found",
      });
    }

    if (plan.status !== "paused") {
      return res.status(409).json({
        success: false,
        error: `Cannot resume plan with status '${plan.status}' (must be 'paused')`,
      });
    }

    plan.status = "executing";
    plan.pausedAt = null;
    await plan.save();
    console.log("[AgentPlan] Plan resumed", { planId: plan._id });

    return res.status(200).json({
      success: true,
      planId: plan._id,
      status: plan.status,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Invalid plan ID format",
      });
    }
    console.error("[AgentPlan] resumePlan error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

exports.getPlanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[AgentPlan] getPlanStatus", { planId: id });

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: "Plan not found",
      });
    }

    console.log("[AgentPlan] Plan status", { planId: plan._id, status: plan.status });
    return res.status(200).json({
      success: true,
      plan: {
        _id: plan._id,
        userId: plan.userId,
        goal: plan.goal,
        status: plan.status,
        currentStepIndex: plan.currentStepIndex,
        startedAt: plan.startedAt,
        pausedAt: plan.pausedAt,
        completedAt: plan.completedAt,
        createdAt: plan.createdAt,
        modifiedLast: plan.modifiedLast,
        steps: plan.steps.map((step) => ({
          stepNumber: step.stepNumber,
          description: step.description,
          tool: step.tool,
          status: step.status,
          result: step.result,
          error: step.error,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
        })),
      },
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Invalid plan ID format",
      });
    }
    console.error("[AgentPlan] getPlanStatus error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

exports.canTransition = canTransition;
